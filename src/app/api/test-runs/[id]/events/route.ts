import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { verifyStreamToken } from '@/lib/security/stream-token';
import { config as appConfig } from '@/config/app';
import { isTestRunProjectMember } from '@/lib/security/permissions';
import { subscribeRunUpdates } from '@/lib/runners/event-bus';
import { objectStore } from '@/lib/storage/object-store';
import { isScreenshotData, type TestEvent, type LogLevel } from '@/types';
import { parseTestResultMetadata } from '@/lib/runtime/test-result-metadata';

export const dynamic = 'force-dynamic';

const logger = createLogger('api:test-runs:events');

interface RunStatusRow {
    status: string;
    error: string | null;
    result: string | null;
    deletedAt: Date | null;
}

interface RunEventRow {
    sequence: number;
    kind: string;
    message: string | null;
    payload: unknown;
    artifactKey: string | null;
    createdAt: Date;
}

interface SignedArtifactUrlCacheEntry {
    url: string;
    expiresAtMs: number;
}

const signedArtifactUrlCache = new Map<string, SignedArtifactUrlCacheEntry>();
const signedArtifactUrlCacheSweepIntervalMs = 60_000;
let nextSignedArtifactUrlCacheSweepAtMs = 0;

function isLogLevel(value: unknown): value is LogLevel {
    return value === 'info' || value === 'error' || value === 'success';
}

function isUiTestEvent(payload: unknown): payload is TestEvent {
    if (!payload || typeof payload !== 'object') {
        return false;
    }

    const candidate = payload as Record<string, unknown>;
    if (candidate.type !== 'log' && candidate.type !== 'screenshot') {
        return false;
    }

    return typeof candidate.timestamp === 'number' && typeof candidate.data === 'object' && candidate.data !== null;
}

function resolveArtifactFilename(artifactKey: string): string {
    const segments = artifactKey.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'artifact.bin';
}

function maybeSweepSignedArtifactUrlCache(nowMs: number): void {
    if (nowMs < nextSignedArtifactUrlCacheSweepAtMs) {
        return;
    }

    nextSignedArtifactUrlCacheSweepAtMs = nowMs + signedArtifactUrlCacheSweepIntervalMs;
    for (const [key, entry] of signedArtifactUrlCache.entries()) {
        if (entry.expiresAtMs <= nowMs) {
            signedArtifactUrlCache.delete(key);
        }
    }
}

async function getCachedSignedArtifactUrl(artifactKey: string): Promise<string> {
    const nowMs = Date.now();
    maybeSweepSignedArtifactUrlCache(nowMs);

    const cached = signedArtifactUrlCache.get(artifactKey);
    if (cached && cached.expiresAtMs > nowMs) {
        return cached.url;
    }

    const signedUrl = await objectStore.getSignedDownloadUrl({
        key: artifactKey,
        filename: resolveArtifactFilename(artifactKey),
        inline: true,
    });

    const ttlMs = Math.max(1, appConfig.storage.signedUrlTtlSeconds * 1000 - 5_000);
    signedArtifactUrlCache.set(artifactKey, {
        url: signedUrl,
        expiresAtMs: nowMs + ttlMs,
    });

    return signedUrl;
}

async function mapRunEventToUiEvent(row: RunEventRow): Promise<TestEvent> {
    if (isUiTestEvent(row.payload)) {
        if (
            row.payload.type === 'screenshot'
            && row.artifactKey
            && isScreenshotData(row.payload.data)
            && row.payload.data.src.startsWith('artifact:')
        ) {
            try {
                const signedUrl = await getCachedSignedArtifactUrl(row.artifactKey);

                return {
                    ...row.payload,
                    data: {
                        ...row.payload.data,
                        src: signedUrl,
                    },
                };
            } catch (error) {
                logger.warn('Failed to resolve signed artifact URL', error);
            }
        }

        return row.payload;
    }

    const level: LogLevel = row.kind.toLowerCase().includes('error') ? 'error' : 'info';
    const message = row.message
        || (row.artifactKey ? `Artifact uploaded: ${row.artifactKey}` : row.kind);

    return {
        type: 'log',
        data: {
            message,
            level: isLogLevel(level) ? level : 'info',
        },
        timestamp: row.createdAt.getTime(),
    };
}

async function resolveAuthorizedUserId(request: Request, runId: string): Promise<string | null> {
    const { searchParams } = new URL(request.url);
    const streamToken = searchParams.get('streamToken');

    const authPayload = await verifyAuth(request);
    if (authPayload) {
        const userId = await resolveUserId(authPayload);
        if (userId) {
            return userId;
        }
    }

    if (!streamToken) {
        return null;
    }

    const streamIdentity = await verifyStreamToken({
        token: streamToken,
        scope: 'test-run-events',
        resourceId: runId,
    });

    return streamIdentity?.userId ?? null;
}

async function fetchRunStatus(runId: string): Promise<RunStatusRow | null> {
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
            status: true,
            error: true,
            result: true,
            deletedAt: true,
        },
    });

    if (!run || run.deletedAt) {
        return null;
    }

    return run;
}

async function fetchRunEventsAfter(runId: string, afterSequence: number): Promise<RunEventRow[]> {
    return prisma.testRunEvent.findMany({
        where: {
            runId,
            sequence: { gt: afterSequence },
        },
        orderBy: { sequence: 'asc' },
        take: 300,
        select: {
            sequence: true,
            kind: true,
            message: true,
            payload: true,
            artifactKey: true,
            createdAt: true,
        },
    });
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: runId } = await params;

    const userId = await resolveAuthorizedUserId(request, runId);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const currentRun = await fetchRunStatus(runId);
    if (!currentRun) {
        return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
    }

    if (!await isTestRunProjectMember(userId, runId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let streamClosed = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let ttlTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;
    let lastSequence = 0;
    let lastStatus = '';

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            const encode = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

            const closeStream = () => {
                if (streamClosed) {
                    return;
                }
                streamClosed = true;
                if (pollInterval) {
                    clearInterval(pollInterval);
                }
                if (ttlTimer) {
                    clearTimeout(ttlTimer);
                    ttlTimer = null;
                }
                if (unsubscribe) {
                    unsubscribe();
                    unsubscribe = null;
                }
                try {
                    controller.close();
                } catch (error) {
                    logger.debug('Stream already closed', error);
                }
            };

            const safeEnqueue = (data: unknown) => {
                if (streamClosed) {
                    return;
                }
                try {
                    controller.enqueue(encode(data));
                } catch (error) {
                    logger.warn('SSE enqueue failed', error);
                    closeStream();
                }
            };

            let flushInProgress = false;
            const flushFromDb = async () => {
                if (streamClosed || flushInProgress) {
                    return;
                }
                flushInProgress = true;

                try {
                    const statusRow = await fetchRunStatus(runId);
                    if (!statusRow) {
                        safeEnqueue({ type: 'status', status: 'FAIL', error: 'Run deleted' });
                        closeStream();
                        return;
                    }

                    if (statusRow.status !== lastStatus) {
                        const metadata = parseTestResultMetadata(statusRow.result);
                        safeEnqueue({
                            type: 'status',
                            status: statusRow.status,
                            error: statusRow.error,
                            errorCode: metadata.errorCode,
                            errorCategory: metadata.errorCategory,
                        });
                        lastStatus = statusRow.status;
                    }

                    const events = await fetchRunEventsAfter(runId, lastSequence);
                    for (const row of events) {
                        safeEnqueue(await mapRunEventToUiEvent(row));
                        lastSequence = row.sequence;
                    }

                    if (['PASS', 'FAIL', 'CANCELLED'].includes(statusRow.status)) {
                        closeStream();
                    }
                } catch (error) {
                    logger.warn('Failed to flush run events from DB', error);
                    closeStream();
                } finally {
                    flushInProgress = false;
                }
            };

            const initialMetadata = parseTestResultMetadata(currentRun.result);
            safeEnqueue({
                type: 'status',
                status: currentRun.status,
                error: currentRun.error,
                errorCode: initialMetadata.errorCode,
                errorCategory: initialMetadata.errorCategory,
            });
            lastStatus = currentRun.status;
            void flushFromDb();

            pollInterval = setInterval(() => {
                void flushFromDb();
            }, appConfig.stream.pollInterval);

            unsubscribe = subscribeRunUpdates(runId, () => {
                void flushFromDb();
            });

            ttlTimer = setTimeout(() => {
                closeStream();
            }, appConfig.stream.sseConnectionTtlMs);
        },
        cancel() {
            streamClosed = true;
            if (pollInterval) {
                clearInterval(pollInterval);
            }
            if (ttlTimer) {
                clearTimeout(ttlTimer);
            }
            if (unsubscribe) {
                unsubscribe();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        },
    });
}
