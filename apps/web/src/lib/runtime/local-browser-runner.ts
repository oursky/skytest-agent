import type { Prisma } from '@prisma/client';
import { runTest } from '@/lib/runtime/test-runner';
import { prisma } from '@/lib/core/prisma';
import { resolveConfigs } from '@/lib/test-config/resolver';
import { decrypt } from '@/lib/security/crypto';
import { createLogger } from '@/lib/core/logger';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { config as appConfig } from '@/config/app';
import { createStoredName, validateAndSanitizeFile, buildRunArtifactObjectKey } from '@/lib/security/file-security';
import { putObjectBuffer } from '@/lib/storage/object-store-utils';
import { UsageService } from '@/lib/runtime/usage';
import {
    RUN_IN_PROGRESS_STATUSES,
    TEST_STATUS,
    isRunInProgressStatus,
    isScreenshotData,
    isRunTerminalStatus,
    type BrowserConfig,
    type RunInProgressStatus,
    type TargetConfig,
    type TestCaseFile,
    type TestEvent,
    type TestStep,
} from '@/types';

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
    usage: {
        actorUserId: string;
        description: string;
    };
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

interface LocalBrowserRunOptions {
    runnerId?: string;
}

const logger = createLogger('runtime:local-browser-runner');
const activeAbortControllers = new Map<string, AbortController>();
const activeExecutions = new Map<string, Promise<void>>();
const RUN_STATUS_WATCH_INTERVAL_MS = 1_000;

function triggerQueuedBrowserDispatch(reason: string, runId: string): void {
    void import('@/lib/runtime/browser-run-dispatcher')
        .then(({ dispatchNextQueuedBrowserRun }) => dispatchNextQueuedBrowserRun())
        .catch((error) => {
            logger.warn('Failed to dispatch queued browser run', {
                runId,
                reason,
                error: error instanceof Error ? error.message : String(error),
            });
        });
}

function createLeaseExpiry(now = new Date()): Date {
    return new Date(now.getTime() + appConfig.runner.leaseDurationSeconds * 1000);
}

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

async function loadRunConfig(runId: string, options?: LocalBrowserRunOptions): Promise<LoadedRunConfig | null> {
    const nowMs = Date.now();
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            testCaseId: true,
            status: true,
            assignedRunnerId: true,
            leaseExpiresAt: true,
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
                    name: true,
                    url: true,
                    prompt: true,
                    steps: true,
                    browserConfig: true,
                    projectId: true,
                    project: {
                        select: {
                            name: true,
                            createdByUserId: true,
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

    if (!run || !isRunInProgressStatus(run.status)) {
        return null;
    }

    if (options?.runnerId) {
        if (run.assignedRunnerId !== options.runnerId) {
            return null;
        }
        if (!run.leaseExpiresAt || run.leaseExpiresAt.getTime() <= nowMs) {
            return null;
        }
    }

    if (!options?.runnerId && run.assignedRunnerId) {
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
        usage: {
            actorUserId: run.testCase.project.createdByUserId,
            description: `${run.testCase.project.name} - ${run.testCase.name}`,
        },
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

async function appendRunEvents(runId: string, events: RunEventInput[], options?: LocalBrowserRunOptions): Promise<void> {
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
                assignedRunnerId: true,
                leaseExpiresAt: true,
                nextEventSequence: true,
            },
        });

        if (!run || isRunTerminalStatus(run.status)) {
            return false;
        }
        if (options?.runnerId) {
            if (run.assignedRunnerId !== options.runnerId) {
                return false;
            }
            if (!run.leaseExpiresAt || run.leaseExpiresAt.getTime() <= now.getTime()) {
                return false;
            }
        }
        if (!options?.runnerId && run.assignedRunnerId) {
            return false;
        }

        const startSequence = run.nextEventSequence;
        const updateResult = await tx.testRun.updateMany({
            where: {
                id: runId,
                nextEventSequence: startSequence,
                ...(options?.runnerId
                    ? {
                        assignedRunnerId: options.runnerId,
                        leaseExpiresAt: { gt: now },
                    }
                    : {
                        assignedRunnerId: null,
                    }),
            },
            data: {
                nextEventSequence: startSequence + events.length,
                lastEventAt: now,
                ...(options?.runnerId
                    ? {
                        leaseExpiresAt: createLeaseExpiry(now),
                    }
                    : {}),
            },
        });
        if (updateResult.count !== 1) {
            return false;
        }

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

async function updateRunStatusWithOwnership(
    runId: string,
    status: RunInProgressStatus,
    options?: LocalBrowserRunOptions
): Promise<void> {
    const now = new Date();
    const result = await prisma.testRun.updateMany({
        where: {
            id: runId,
            status: {
                in: [...RUN_IN_PROGRESS_STATUSES],
            },
            ...(options?.runnerId
                ? {
                    assignedRunnerId: options.runnerId,
                    leaseExpiresAt: { gt: now },
                }
                : {
                    assignedRunnerId: null,
                }),
        },
        data: {
            status,
            ...(options?.runnerId
                ? {
                    leaseExpiresAt: createLeaseExpiry(now),
                }
                : {}),
        },
    });

    if (result.count > 0) {
        publishRunUpdate(runId);
    }
}

function buildRunOwnershipWhere(runId: string, options?: LocalBrowserRunOptions) {
    const now = new Date();
    return {
        id: runId,
        status: {
            in: [...RUN_IN_PROGRESS_STATUSES],
        },
        ...(options?.runnerId
            ? {
                assignedRunnerId: options.runnerId,
                leaseExpiresAt: { gt: now },
            }
            : {
                assignedRunnerId: null,
            }),
    };
}

async function runStillActive(runId: string, options?: LocalBrowserRunOptions): Promise<boolean> {
    const run = await prisma.testRun.findFirst({
        where: buildRunOwnershipWhere(runId, options),
        select: { id: true },
    });
    return !!run;
}

async function completeRun(
    runId: string,
    testCaseId: string,
    usage: LoadedRunConfig['usage'] & { projectId: string },
    result?: string,
    options?: LocalBrowserRunOptions
): Promise<void> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: buildRunOwnershipWhere(runId, options),
        data: {
            status: TEST_STATUS.PASS,
            result,
            completedAt: now,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        },
    });

    if (updated.count > 0) {
        await prisma.testCase.update({
            where: { id: testCaseId },
            data: { status: TEST_STATUS.PASS },
        });
        try {
            await UsageService.recordRunUsageFromResult({
                actorUserId: usage.actorUserId,
                projectId: usage.projectId,
                result,
                description: usage.description,
                testRunId: runId,
            });
        } catch (error) {
            logger.warn('Failed to record usage for completed run', {
                runId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        publishRunUpdate(runId);
        triggerQueuedBrowserDispatch('complete', runId);
    }
}

async function failRun(
    runId: string,
    testCaseId: string,
    usage: LoadedRunConfig['usage'] & { projectId: string },
    error: string,
    result?: string,
    options?: LocalBrowserRunOptions
): Promise<void> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: buildRunOwnershipWhere(runId, options),
        data: {
            status: TEST_STATUS.FAIL,
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
            data: { status: TEST_STATUS.FAIL },
        });
        try {
            await UsageService.recordRunUsageFromResult({
                actorUserId: usage.actorUserId,
                projectId: usage.projectId,
                result,
                description: usage.description,
                testRunId: runId,
            });
        } catch (usageError) {
            logger.warn('Failed to record usage for failed run', {
                runId,
                error: usageError instanceof Error ? usageError.message : String(usageError),
            });
        }
        publishRunUpdate(runId);
        triggerQueuedBrowserDispatch('fail', runId);
    }
}

async function failRunWithoutTestCase(runId: string, error: string, options?: LocalBrowserRunOptions): Promise<void> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: buildRunOwnershipWhere(runId, options),
        data: {
            status: TEST_STATUS.FAIL,
            error,
            completedAt: now,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        },
    });

    if (updated.count > 0) {
        publishRunUpdate(runId);
        triggerQueuedBrowserDispatch('fail_without_test_case', runId);
    }
}

async function cancelRun(
    runId: string,
    testCaseId: string,
    usage: LoadedRunConfig['usage'] & { projectId: string },
    result?: string,
    options?: LocalBrowserRunOptions
): Promise<void> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: buildRunOwnershipWhere(runId, options),
        data: {
            status: TEST_STATUS.CANCELLED,
            error: 'Cancelled by user',
            completedAt: now,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        },
    });

    if (updated.count > 0) {
        await prisma.testCase.update({
            where: { id: testCaseId },
            data: { status: TEST_STATUS.CANCELLED },
        });
        try {
            await UsageService.recordRunUsageFromResult({
                actorUserId: usage.actorUserId,
                projectId: usage.projectId,
                result,
                description: usage.description,
                testRunId: runId,
            });
        } catch (usageError) {
            logger.warn('Failed to record usage for cancelled run', {
                runId,
                error: usageError instanceof Error ? usageError.message : String(usageError),
            });
        }
        publishRunUpdate(runId);
        triggerQueuedBrowserDispatch('cancel', runId);
    }
}

async function uploadRunArtifact(runId: string, input: {
    filename: string;
    mimeType: string;
    contentBase64: string;
}, options?: LocalBrowserRunOptions): Promise<string | null> {
    if (options?.runnerId) {
        const ownedRun = await prisma.testRun.findFirst({
            where: {
                id: runId,
                assignedRunnerId: options.runnerId,
                leaseExpiresAt: { gt: new Date() },
                status: { in: [...RUN_IN_PROGRESS_STATUSES] },
            },
            select: { id: true },
        });
        if (!ownedRun) {
            return null;
        }
    }

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

async function executeLocalBrowserRun(
    runId: string,
    controller: AbortController,
    options?: LocalBrowserRunOptions
): Promise<void> {
    const details = await loadRunConfig(runId, options);
    if (!details) {
        await failRunWithoutTestCase(runId, 'Run is not executable', options).catch(() => {});
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
                await appendRunEvents(runId, batch, options);
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
                    }, options);

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

    const statusWatchTimer = setInterval(() => {
        void runStillActive(runId, options)
            .then((active) => {
                if (!active) {
                    cancelLocalBrowserRun(runId);
                }
            })
            .catch((error) => {
                logger.warn('Failed to poll local run status', {
                    runId,
                    error: error instanceof Error ? error.message : String(error),
                });
            });
    }, RUN_STATUS_WATCH_INTERVAL_MS);

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
                await updateRunStatusWithOwnership(runId, TEST_STATUS.PREPARING, options);
                queueEvent({
                    kind: 'STATUS',
                    message: 'Preparing run execution',
                });
            },
            async onRunning() {
                await updateRunStatusWithOwnership(runId, TEST_STATUS.RUNNING, options);
                queueEvent({
                    kind: 'STATUS',
                    message: 'Running test steps',
                });
            },
        });

        await Promise.allSettled(Array.from(pendingArtifactUploads));
        await flushEvents();

        const resultSummary = JSON.stringify(result);
        if (result.status === TEST_STATUS.PASS) {
            await completeRun(
                runId,
                details.testCaseId,
                {
                    actorUserId: details.usage.actorUserId,
                    projectId: details.projectId,
                    description: details.usage.description,
                },
                resultSummary,
                options
            );
            return;
        }
        if (result.status === TEST_STATUS.CANCELLED) {
            await cancelRun(
                runId,
                details.testCaseId,
                {
                    actorUserId: details.usage.actorUserId,
                    projectId: details.projectId,
                    description: details.usage.description,
                },
                resultSummary,
                options
            );
            return;
        }

        await failRun(
            runId,
            details.testCaseId,
            {
                actorUserId: details.usage.actorUserId,
                projectId: details.projectId,
                description: details.usage.description,
            },
            result.error ?? 'Run failed',
            resultSummary,
            options
        );
    } catch (error) {
        await Promise.allSettled(Array.from(pendingArtifactUploads));
        await flushEvents();
        const errorMessage = error instanceof Error ? error.message : String(error);
        await failRun(
            runId,
            details.testCaseId,
            {
                actorUserId: details.usage.actorUserId,
                projectId: details.projectId,
                description: details.usage.description,
            },
            errorMessage,
            undefined,
            options
        );
    } finally {
        clearInterval(statusWatchTimer);
    }
}

export function startLocalBrowserRun(runId: string, options?: LocalBrowserRunOptions): Promise<void> {
    const existingExecution = activeExecutions.get(runId);
    if (existingExecution) {
        return existingExecution;
    }

    const controller = new AbortController();
    activeAbortControllers.set(runId, controller);

    const execution = executeLocalBrowserRun(runId, controller, options)
        .catch((error) => {
            logger.error('Local browser run execution failed', error);
        })
        .finally(() => {
            activeAbortControllers.delete(runId);
            activeExecutions.delete(runId);
        });

    activeExecutions.set(runId, execution);
    return execution;
}

export function cancelLocalBrowserRun(runId: string): void {
    const controller = activeAbortControllers.get(runId);
    if (!controller || controller.signal.aborted) {
        return;
    }
    controller.abort();
}
