import type { Prisma } from '@prisma/client';
import { runTest } from '@/lib/runtime/test-runner';
import { prisma } from '@/lib/core/prisma';
import { resolveConfigs } from '@/lib/config/resolver';
import { decrypt } from '@/lib/security/crypto';
import { createLogger } from '@/lib/core/logger';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { config as appConfig } from '@/config/app';
import { createStoredName, validateAndSanitizeFile, buildRunArtifactObjectKey } from '@/lib/security/file-security';
import { putObjectBuffer } from '@/lib/storage/object-store-utils';
import { isScreenshotData, type BrowserConfig, type TargetConfig, type TestCaseFile, type TestEvent, type TestStep } from '@/types';

interface SnapshotPayload {
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
}

interface LoadedRunConfig {
    runId: string;
    testCaseId: string;
    projectId: string;
    config: {
        url?: string;
        prompt?: string;
        steps?: TestStep[];
        browserConfig?: Record<string, BrowserConfig | TargetConfig>;
        openRouterApiKey: string;
        files: TestCaseFile[];
        resolvedVariables: Record<string, string>;
        resolvedFiles: Record<string, string>;
    };
}

interface RunEventInput {
    kind: string;
    message?: string;
    payload?: unknown;
    artifactKey?: string;
}

interface ParsedImageDataUrl {
    mimeType: string;
    extension: string;
    contentBase64: string;
}

const logger = createLogger('runtime:local-browser-runner');
const activeAbortControllers = new Map<string, AbortController>();
const activeExecutions = new Map<string, Promise<void>>();

function parseConfigurationSnapshot(snapshot: string | null): SnapshotPayload {
    if (!snapshot) {
        return {};
    }

    try {
        const parsed = JSON.parse(snapshot) as SnapshotPayload;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function parseSerializedJson<T>(value: string | null): T | undefined {
    if (!value) {
        return undefined;
    }

    try {
        return JSON.parse(value) as T;
    } catch {
        return undefined;
    }
}

function parseImageDataUrl(value: string): ParsedImageDataUrl | null {
    const match = /^data:([^;]+);base64,(.+)$/i.exec(value.trim());
    if (!match) {
        return null;
    }

    const mimeType = match[1].toLowerCase();
    const contentBase64 = match[2].replace(/\s+/g, '');
    if (!contentBase64) {
        return null;
    }

    const extension = mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/png'
            ? 'png'
            : mimeType === 'image/webp'
                ? 'webp'
                : mimeType === 'image/gif'
                    ? 'gif'
                    : 'bin';

    return {
        mimeType,
        extension,
        contentBase64,
    };
}

function toSafeScreenshotFilename(label: string, extension: string): string {
    const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const base = normalized.length > 0 ? normalized.slice(0, 80) : 'screenshot';
    return `${base}-${Date.now()}.${extension}`;
}

async function loadRunConfig(runId: string): Promise<LoadedRunConfig | null> {
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            testCaseId: true,
            status: true,
            configurationSnapshot: true,
            files: {
                select: {
                    id: true,
                    filename: true,
                    storedName: true,
                    mimeType: true,
                    size: true,
                },
            },
            testCase: {
                select: {
                    id: true,
                    url: true,
                    prompt: true,
                    steps: true,
                    browserConfig: true,
                    projectId: true,
                    project: {
                        select: {
                            team: {
                                select: {
                                    openRouterKeyEncrypted: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!run || !['PREPARING', 'RUNNING'].includes(run.status)) {
        return null;
    }

    const encryptedKey = run.testCase.project.team.openRouterKeyEncrypted;
    if (!encryptedKey) {
        return null;
    }

    const snapshot = parseConfigurationSnapshot(run.configurationSnapshot);
    const resolved = await resolveConfigs(run.testCase.projectId, run.testCaseId);
    const fallbackSteps = parseSerializedJson<TestStep[]>(run.testCase.steps);
    const fallbackBrowserConfig = parseSerializedJson<Record<string, BrowserConfig | TargetConfig>>(run.testCase.browserConfig);

    return {
        runId: run.id,
        testCaseId: run.testCase.id,
        projectId: run.testCase.projectId,
        config: {
            url: snapshot.url ?? run.testCase.url,
            prompt: snapshot.prompt ?? run.testCase.prompt ?? undefined,
            steps: snapshot.steps ?? fallbackSteps,
            browserConfig: snapshot.browserConfig ?? fallbackBrowserConfig,
            openRouterApiKey: decrypt(encryptedKey),
            files: run.files,
            resolvedVariables: resolved.variables,
            resolvedFiles: resolved.files,
        },
    };
}

async function appendRunEvents(runId: string, events: RunEventInput[]): Promise<void> {
    if (events.length === 0) {
        return;
    }

    const now = new Date();
    const appended = await prisma.$transaction(async (tx) => {
        const run = await tx.testRun.findUnique({
            where: { id: runId },
            select: {
                id: true,
                status: true,
                nextEventSequence: true,
            },
        });

        if (!run || ['PASS', 'FAIL', 'CANCELLED'].includes(run.status)) {
            return false;
        }

        const startSequence = run.nextEventSequence;
        await tx.testRun.update({
            where: { id: runId },
            data: {
                nextEventSequence: startSequence + events.length,
                lastEventAt: now,
            },
        });

        await tx.testRunEvent.createMany({
            data: events.map((event, index) => ({
                runId,
                sequence: startSequence + index,
                kind: event.kind,
                message: event.message ?? null,
                payload: event.payload as Prisma.InputJsonValue | undefined,
                artifactKey: event.artifactKey ?? null,
                createdAt: now,
            })),
        });

        return true;
    });

    if (appended) {
        publishRunUpdate(runId);
    }
}

async function updateRunStatus(runId: string, status: 'PREPARING' | 'RUNNING'): Promise<void> {
    const result = await prisma.testRun.updateMany({
        where: {
            id: runId,
            status: {
                in: ['PREPARING', 'RUNNING'],
            },
        },
        data: {
            status,
        },
    });

    if (result.count > 0) {
        publishRunUpdate(runId);
    }
}

async function completeRun(runId: string, testCaseId: string, result?: string): Promise<void> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: {
            id: runId,
            status: {
                in: ['PREPARING', 'RUNNING'],
            },
        },
        data: {
            status: 'PASS',
            result,
            completedAt: now,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        },
    });

    if (updated.count > 0) {
        await prisma.testCase.update({
            where: { id: testCaseId },
            data: { status: 'PASS' },
        });
        publishRunUpdate(runId);
    }
}

async function failRun(runId: string, testCaseId: string, error: string, result?: string): Promise<void> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: {
            id: runId,
            status: {
                in: ['PREPARING', 'RUNNING'],
            },
        },
        data: {
            status: 'FAIL',
            error,
            result,
            completedAt: now,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        },
    });

    if (updated.count > 0) {
        await prisma.testCase.update({
            where: { id: testCaseId },
            data: { status: 'FAIL' },
        });
        publishRunUpdate(runId);
    }
}

async function failRunWithoutTestCase(runId: string, error: string): Promise<void> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: {
            id: runId,
            status: {
                in: ['PREPARING', 'RUNNING'],
            },
        },
        data: {
            status: 'FAIL',
            error,
            completedAt: now,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        },
    });

    if (updated.count > 0) {
        publishRunUpdate(runId);
    }
}

async function cancelRun(runId: string): Promise<void> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: {
            id: runId,
            status: {
                in: ['PREPARING', 'RUNNING'],
            },
        },
        data: {
            status: 'CANCELLED',
            error: 'Cancelled by user',
            completedAt: now,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        },
    });

    if (updated.count > 0) {
        publishRunUpdate(runId);
    }
}

async function uploadRunArtifact(runId: string, input: {
    filename: string;
    mimeType: string;
    contentBase64: string;
}): Promise<string | null> {
    const body = Buffer.from(input.contentBase64, 'base64');
    if (body.length === 0 || body.length > appConfig.files.maxFileSize) {
        return null;
    }

    const validation = validateAndSanitizeFile(input.filename, input.mimeType, body.length);
    if (!validation.valid) {
        return null;
    }

    const storedName = validation.storedName ?? createStoredName(input.filename);
    const artifactKey = buildRunArtifactObjectKey(runId, storedName);

    await putObjectBuffer({
        key: artifactKey,
        body,
        contentType: input.mimeType,
    });

    await prisma.testRunFile.create({
        data: {
            runId,
            filename: validation.sanitizedFilename ?? input.filename,
            storedName: artifactKey,
            mimeType: input.mimeType,
            size: body.length,
        },
    });

    return artifactKey;
}

async function executeLocalBrowserRun(runId: string, controller: AbortController): Promise<void> {
    const details = await loadRunConfig(runId);
    if (!details) {
        await failRunWithoutTestCase(runId, 'Run is not executable').catch(() => {});
        return;
    }

    const queuedEvents: RunEventInput[] = [];
    const pendingArtifactUploads = new Set<Promise<void>>();
    let flushingEvents = false;

    const flushEvents = async () => {
        if (flushingEvents || queuedEvents.length === 0) {
            return;
        }

        flushingEvents = true;
        try {
            while (queuedEvents.length > 0) {
                const batch = queuedEvents.splice(0, 50);
                await appendRunEvents(runId, batch);
            }
        } finally {
            flushingEvents = false;
        }
    };

    const queueEvent = (event: RunEventInput) => {
        queuedEvents.push(event);
        void flushEvents();
    };

    const handleTestEvent = (event: TestEvent) => {
        const screenshotData = event.type === 'screenshot' && isScreenshotData(event.data)
            ? event.data
            : null;

        if (screenshotData) {
            const uploadTask = (async () => {
                const parsed = parseImageDataUrl(screenshotData.src);
                if (!parsed) {
                    queueEvent({
                        kind: 'SCREENSHOT',
                        message: screenshotData.label,
                        payload: event,
                    });
                    return;
                }

                try {
                    const artifactKey = await uploadRunArtifact(runId, {
                        filename: toSafeScreenshotFilename(screenshotData.label, parsed.extension),
                        mimeType: parsed.mimeType,
                        contentBase64: parsed.contentBase64,
                    });

                    queueEvent({
                        kind: 'SCREENSHOT',
                        message: screenshotData.label,
                        artifactKey: artifactKey ?? undefined,
                        payload: artifactKey
                            ? {
                                ...event,
                                data: {
                                    ...screenshotData,
                                    src: `artifact:${artifactKey}`,
                                },
                            }
                            : event,
                    });
                } catch (error) {
                    logger.warn('Failed to upload screenshot artifact', error);
                    queueEvent({
                        kind: 'SCREENSHOT',
                        message: screenshotData.label,
                        payload: event,
                    });
                }
            })();

            pendingArtifactUploads.add(uploadTask);
            uploadTask.finally(() => {
                pendingArtifactUploads.delete(uploadTask);
            }).catch(() => {});
            return;
        }

        queueEvent({
            kind: event.type.toUpperCase(),
            message: event.type === 'log' && 'message' in event.data ? event.data.message : undefined,
            payload: event,
        });
    };

    try {
        const result = await runTest({
            runId,
            config: {
                url: details.config.url,
                prompt: details.config.prompt,
                steps: details.config.steps,
                browserConfig: details.config.browserConfig,
                openRouterApiKey: details.config.openRouterApiKey,
                testCaseId: details.testCaseId,
                projectId: details.projectId,
                files: details.config.files,
                resolvedVariables: details.config.resolvedVariables,
                resolvedFiles: details.config.resolvedFiles,
            },
            signal: controller.signal,
            onEvent(event) {
                handleTestEvent(event);
            },
            async onPreparing() {
                await updateRunStatus(runId, 'PREPARING');
                queueEvent({
                    kind: 'STATUS',
                    message: 'Preparing run execution',
                });
            },
            async onRunning() {
                await updateRunStatus(runId, 'RUNNING');
                queueEvent({
                    kind: 'STATUS',
                    message: 'Running test steps',
                });
            },
        });

        await Promise.allSettled(Array.from(pendingArtifactUploads));
        await flushEvents();

        const resultSummary = JSON.stringify(result);
        if (result.status === 'PASS') {
            await completeRun(runId, details.testCaseId, resultSummary);
            return;
        }
        if (result.status === 'CANCELLED') {
            await cancelRun(runId);
            return;
        }

        await failRun(runId, details.testCaseId, result.error ?? 'Run failed', resultSummary);
    } catch (error) {
        await Promise.allSettled(Array.from(pendingArtifactUploads));
        await flushEvents();
        const errorMessage = error instanceof Error ? error.message : String(error);
        await failRun(runId, details.testCaseId, errorMessage);
    }
}

export function startLocalBrowserRun(runId: string): void {
    if (activeExecutions.has(runId)) {
        return;
    }

    const controller = new AbortController();
    activeAbortControllers.set(runId, controller);

    const execution = executeLocalBrowserRun(runId, controller)
        .catch((error) => {
            logger.error('Local browser run execution failed', error);
        })
        .finally(() => {
            activeAbortControllers.delete(runId);
            activeExecutions.delete(runId);
        });

    activeExecutions.set(runId, execution);
}

export function cancelLocalBrowserRun(runId: string): void {
    const controller = activeAbortControllers.get(runId);
    if (!controller || controller.signal.aborted) {
        return;
    }
    controller.abort();
}
