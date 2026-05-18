import type { Prisma } from '@prisma/client';
import { runTest } from '@/lib/runtime/test-runner';
import type { BuildMidsceneModelConfigOptions } from '@/lib/runtime/midscene-env';
import { buildTeamAiProviderConfig, resolveTeamMidsceneConfig } from '@/lib/runtime/team-ai-config';
import { prisma } from '@/lib/core/prisma';
import { resolveConfigs } from '@/lib/test-config/resolver';
import { decrypt } from '@/lib/security/crypto';
import { createLogger } from '@/lib/core/logger';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { config as appConfig } from '@/config/app';
import { createStoredName, validateAndSanitizeFile, buildRunArtifactObjectKey } from '@/lib/security/file-security';
import { putObjectBuffer } from '@/lib/storage/object-store-utils';
import { InvalidAiApiKeyError } from '@/lib/core/errors';
import {
    buildResolvedConfigMapsFromSnapshot,
    parseConfigurationSnapshot,
    parseImageDataUrl,
    parseSerializedJson,
    toSafeScreenshotFilename,
} from '@/lib/runtime/local-browser-runner-parsers';
import {
    cancelRun,
    completeRun,
    createLeaseExpiry,
    failRun,
    failRunWithoutTestCase,
    runStillActive,
    updateRunStatusWithOwnership,
    type LocalBrowserRunOptions,
} from '@/lib/runtime/local-browser-runner-lifecycle';
import {
    RUN_IN_PROGRESS_STATUSES,
    TEST_STATUS,
    isRunInProgressStatus,
    isScreenshotData,
    isRunTerminalStatus,
    type BrowserConfig,
    type TargetConfig,
    type TestCaseFile,
    type TestEvent,
    type TestStep,
} from '@/types';
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
            teamId: string;
            aiProvider: string;
            midsceneModelOptions?: BuildMidsceneModelConfigOptions;
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
const logger = createLogger('runtime:local-browser-runner');
const activeAbortControllers = new Map<string, AbortController>();
const activeExecutions = new Map<string, Promise<void>>();
const RUN_STATUS_WATCH_INTERVAL_MS = appConfig.runner.runStatusPollIntervalMs;
const RUN_STATUS_MAX_CANCELLATION_POLL_INTERVAL_MS = appConfig.runner.runStatusMaxCancellationPollIntervalMs;
export function getActiveLocalBrowserRunCount(): number {
    return activeExecutions.size;
}
export function getMaxLocalBrowserRunCount(): number {
    return appConfig.runner.maxLocalBrowserRuns;
}
export function hasLocalBrowserRunCapacity(): boolean {
    return getActiveLocalBrowserRunCount() < getMaxLocalBrowserRunCount();
}
export function getActiveLocalBrowserRunIds(): string[] {
    return Array.from(activeAbortControllers.keys());
}

export async function abortInactiveLocalBrowserRuns(options?: LocalBrowserRunOptions): Promise<number> {
    const activeRunIds = getActiveLocalBrowserRunIds();
    if (activeRunIds.length === 0) {
        return 0;
    }

    const nowMs = Date.now();
    const runs = await prisma.testRun.findMany({
        where: {
            id: { in: activeRunIds },
        },
        select: {
            id: true,
            status: true,
            assignedRunnerId: true,
            leaseExpiresAt: true,
        },
    });
    const runById = new Map(runs.map((run) => [run.id, run]));
    let abortedCount = 0;

    for (const runId of activeRunIds) {
        const run = runById.get(runId);
        const leaseValid = run?.leaseExpiresAt ? run.leaseExpiresAt.getTime() > nowMs : false;
        const stillActive = run
            && isRunInProgressStatus(run.status)
            && (
                options?.runnerId
                    ? run.assignedRunnerId === options.runnerId
                    && leaseValid
                    : !run.assignedRunnerId
            );
        if (stillActive) {
            continue;
        }

        if (cancelLocalBrowserRun(runId)) {
            abortedCount += 1;
        }
    }

    return abortedCount;
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
                            teamId: true,
                            createdByUserId: true,
                            team: {
                                select: {
                                    openRouterKeyEncrypted: true,
                                    aiProvider: true,
                                    aiBaseUrl: true,
                                    aiMainModel: true,
                                    aiMainModelFamily: true,
                                    aiPlanningModel: true,
                                    aiPlanningModelFamily: true,
                                    aiInsightModel: true,
                                    aiInsightModelFamily: true,
                                    aiTemperature: true,
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
        logger.warn('Run skipped: team AI key not configured', { runId: run.id });
        return null;
    }

    const snapshot = parseConfigurationSnapshot(run.configurationSnapshot);
    const resolvedFromSnapshot = buildResolvedConfigMapsFromSnapshot(snapshot);
    let resolvedVariables: Record<string, string>;
    let resolvedFiles: Record<string, string>;

    if (resolvedFromSnapshot) {
        resolvedVariables = resolvedFromSnapshot.resolvedVariables;
        resolvedFiles = resolvedFromSnapshot.resolvedFiles;
    } else {
        const resolved = await resolveConfigs(run.testCase.projectId, run.testCaseId);
        resolvedVariables = resolved.variables;
        resolvedFiles = resolved.files;
    }
    const fallbackSteps = parseSerializedJson<TestStep[]>(run.testCase.steps);
    const fallbackBrowserConfig = parseSerializedJson<Record<string, BrowserConfig | TargetConfig>>(run.testCase.browserConfig);
    const providerConfig = buildTeamAiProviderConfig(run.testCase.project.team);
    const midsceneModelOptions = resolveTeamMidsceneConfig(run.testCase.project.team);

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
            teamId: run.testCase.project.teamId,
            aiProvider: providerConfig.provider,
            midsceneModelOptions,
            files: run.files,
            resolvedVariables,
            resolvedFiles,
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

async function touchRunActivity(runId: string, options?: LocalBrowserRunOptions): Promise<void> {
    const now = new Date();
    await prisma.testRun.updateMany({
        where: {
            id: runId,
            status: { in: [...RUN_IN_PROGRESS_STATUSES] },
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
            lastEventAt: now,
            ...(options?.runnerId
                ? {
                    leaseExpiresAt: createLeaseExpiry(now),
                }
                : {}),
        },
    });
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

    let statusWatchTimer: ReturnType<typeof setTimeout> | null = null;
    let statusPollIntervalMs = RUN_STATUS_WATCH_INTERVAL_MS;
    const maxStatusPollIntervalMs = Math.min(
        appConfig.runner.runStatusMaxPollIntervalMs,
        RUN_STATUS_MAX_CANCELLATION_POLL_INTERVAL_MS
    );
    const scheduleStatusPoll = () => {
        if (controller.signal.aborted) {
            return;
        }
        if (statusWatchTimer) {
            clearTimeout(statusWatchTimer);
        }
        statusWatchTimer = setTimeout(() => {
            void pollRunStatus();
        }, statusPollIntervalMs);
    };
    const pollRunStatus = async () => {
        if (controller.signal.aborted) {
            return;
        }

        try {
            const active = await runStillActive(runId, options);
            if (!active) {
                cancelLocalBrowserRun(runId);
                return;
            }

            statusPollIntervalMs = Math.min(
                maxStatusPollIntervalMs,
                Math.floor(statusPollIntervalMs * 1.5)
            );
        } catch (error) {
            logger.warn('Failed to poll local run status', {
                runId,
                error: error instanceof Error ? error.message : String(error),
            });
            statusPollIntervalMs = Math.min(
                maxStatusPollIntervalMs,
                Math.floor(statusPollIntervalMs * 2)
            );
        }

        scheduleStatusPoll();
    };
    scheduleStatusPoll();

    try {
        const result = await runTest({
            runId,
            config: {
                url: details.config.url,
                prompt: details.config.prompt,
                steps: details.config.steps,
                browserConfig: details.config.browserConfig,
                teamId: details.config.teamId,
                openRouterApiKey: details.config.openRouterApiKey,
                aiProvider: details.config.aiProvider,
                midsceneModelOptions: details.config.midsceneModelOptions,
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
            async onStepHeartbeat() {
                await touchRunActivity(runId, options);
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
        const isInvalidAiKey = error instanceof InvalidAiApiKeyError;
        if (error instanceof InvalidAiApiKeyError) {
            logger.error('Invalid team AI key format detected while dispatching local browser run', {
                runId: details.runId,
                teamId: details.config.teamId,
                provider: details.config.aiProvider,
                modelFamily: details.config.midsceneModelOptions?.mainModelFamily ?? null,
                reason: error.reason,
            });
        }
        // UI localizes via errorCode (see ResultStatus.tsx). This fallback string
        // is written to DB and surfaces only where errorCode branching is absent.
        const errorMessage = isInvalidAiKey
            ? 'Team AI key format invalid. Re-save key in Team Settings.'
            : error instanceof Error
                ? error.message
                : String(error);
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
        if (statusWatchTimer) {
            clearTimeout(statusWatchTimer);
        }
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

export function cancelLocalBrowserRun(runId: string): boolean {
    const controller = activeAbortControllers.get(runId);
    if (!controller || controller.signal.aborted) {
        return false;
    }
    controller.abort();
    return true;
}
