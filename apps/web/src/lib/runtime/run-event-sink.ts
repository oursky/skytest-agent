import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { config as appConfig } from '@/config/app';
import { createStoredName, validateAndSanitizeFile, buildRunArtifactObjectKey } from '@/lib/security/file-security';
import { putObjectBuffer } from '@/lib/storage/object-store-utils';
import { parseImageDataUrl, toSafeScreenshotFilename } from '@/lib/runtime/local-browser-runner-parsers';
import {
    createLeaseExpiry,
    runStillActive,
    type LocalBrowserRunOptions,
} from '@/lib/runtime/local-browser-runner-lifecycle';
import {
    RUN_IN_PROGRESS_STATUSES,
    isScreenshotData,
    isRunTerminalStatus,
    type TestEvent,
} from '@/types';

const logger = createLogger('runtime:run-event-sink');

export interface RunEventInput {
    kind: string;
    message?: string;
    payload?: unknown;
    artifactKey?: string;
}

export async function appendRunEvents(runId: string, events: RunEventInput[], options?: LocalBrowserRunOptions): Promise<void> {
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

export async function touchRunActivity(runId: string, options?: LocalBrowserRunOptions): Promise<void> {
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

export async function uploadRunArtifact(runId: string, input: {
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

export interface RunEventSink {
    handleTestEvent: (event: TestEvent) => void;
    queueEvent: (event: RunEventInput) => void;
    flush: () => Promise<void>;
    settleUploads: () => Promise<void>;
}

/**
 * Buffers a single run's events, uploads screenshot artifacts to object storage,
 * and flushes batches to the database. Shared by the single-run executor and the
 * multi-member session orchestrator so both persist events identically.
 */
export function createRunEventSink(runId: string, options?: LocalBrowserRunOptions): RunEventSink {
    const queuedEvents: RunEventInput[] = [];
    const pendingArtifactUploads = new Set<Promise<void>>();
    let flushingEvents = false;

    const flush = async () => {
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
        void flush();
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

    const settleUploads = async () => {
        await Promise.allSettled(Array.from(pendingArtifactUploads));
    };

    return { handleTestEvent, queueEvent, flush, settleUploads };
}

/**
 * Polls a run's liveness on an increasing interval and invokes onInactive when
 * the run is no longer claimable (e.g. cancelled or lease lost), so the caller
 * can abort execution.
 */
export function createRunStatusWatcher(
    runId: string,
    signal: AbortSignal,
    onInactive: () => void,
    options?: LocalBrowserRunOptions,
): { start: () => void; stop: () => void } {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let intervalMs = appConfig.runner.runStatusPollIntervalMs;
    const maxIntervalMs = Math.min(
        appConfig.runner.runStatusMaxPollIntervalMs,
        appConfig.runner.runStatusMaxCancellationPollIntervalMs,
    );

    const schedule = () => {
        if (signal.aborted) {
            return;
        }
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            void poll();
        }, intervalMs);
    };

    const poll = async () => {
        if (signal.aborted) {
            return;
        }
        try {
            const active = await runStillActive(runId, options);
            if (!active) {
                onInactive();
                return;
            }
            intervalMs = Math.min(maxIntervalMs, Math.floor(intervalMs * 1.5));
        } catch (error) {
            logger.warn('Failed to poll local run status', {
                runId,
                error: error instanceof Error ? error.message : String(error),
            });
            intervalMs = Math.min(maxIntervalMs, Math.floor(intervalMs * 2));
        }
        schedule();
    };

    return {
        start: () => schedule(),
        stop: () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        },
    };
}
