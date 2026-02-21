import { NextResponse } from 'next/server';
import { queue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { verifyStreamToken } from '@/lib/stream-token';
import { config as appConfig } from '@/config/app';
import { TestEvent } from '@/types';

export const dynamic = 'force-dynamic';

const logger = createLogger('api:test-runs:events');

function isTestEvent(value: unknown): value is TestEvent {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const event = value as Partial<TestEvent> & { data?: unknown };
    const hasValidType = event.type === 'log' || event.type === 'screenshot';
    return hasValidType && typeof event.timestamp === 'number' && typeof event.data === 'object' && event.data !== null;
}

function parseStoredEvents(stored: string | null | undefined): TestEvent[] {
    if (!stored) {
        return [];
    }

    const trimmed = stored.trim();
    if (!trimmed) {
        return [];
    }

    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            return parsed.filter(isTestEvent);
        }
    } catch {
        // Fallback to NDJSON parsing.
    }

    const events: TestEvent[] = [];
    for (const line of trimmed.split('\n')) {
        const eventLine = line.trim();
        if (!eventLine) {
            continue;
        }

        try {
            const parsed = JSON.parse(eventLine);
            if (isTestEvent(parsed)) {
                events.push(parsed);
            }
        } catch {
            // Ignore malformed lines to keep stream alive.
        }
    }

    return events;
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { searchParams } = new URL(request.url);
    const streamToken = searchParams.get('streamToken');

    const { id } = await params;

    let userId: string | null = null;
    const authPayload = await verifyAuth(request);
    if (authPayload) {
        userId = await resolveUserId(authPayload);
    }

    if (!userId && streamToken) {
        const streamIdentity = await verifyStreamToken({
            token: streamToken,
            scope: 'test-run-events',
            resourceId: id
        });
        userId = streamIdentity?.userId ?? null;
    }

    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const testRun = await prisma.testRun.findUnique({
        where: { id },
        select: {
            status: true,
            error: true,
            result: true,
            logs: true,
            testCase: {
                select: {
                    project: { select: { userId: true } }
                }
            }
        }
    });

    if (!testRun) {
        return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
    }

    if (testRun.testCase.project.userId !== userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let ttlTimer: ReturnType<typeof setTimeout> | null = null;
    let streamClosed = false;

    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const encode = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

            const closeStream = () => {
                if (streamClosed) return;
                streamClosed = true;
                if (pollInterval) {
                    clearInterval(pollInterval);
                }
                if (ttlTimer) {
                    clearTimeout(ttlTimer);
                    ttlTimer = null;
                }
                try {
                    controller.close();
                } catch (error) {
                    logger.debug('Stream already closed', error);
                }
            };

            const safeEnqueue = (data: unknown) => {
                if (streamClosed) return;
                try {
                    controller.enqueue(encode(data));
                } catch (error) {
                    if (!(error instanceof TypeError && error.message.includes('Controller is already closed'))) {
                        logger.warn('Stream enqueue failed', error);
                    }
                    closeStream();
                }
            };

            if (['PASS', 'FAIL', 'CANCELLED'].includes(testRun.status)) {
                safeEnqueue({ type: 'status', status: testRun.status, error: testRun.error });

                const events = parseStoredEvents(testRun.result ?? testRun.logs);
                for (const event of events) {
                    safeEnqueue(event);
                }

                closeStream();
                return;
            }

            const currentStatus = queue.getStatus(id) ?? testRun.status;
            safeEnqueue({ type: 'status', status: currentStatus });

            let lastIndex = 0;
            let lastSentStatus = currentStatus;

            const tryEnqueueStoredEvents = (stored: string | null | undefined) => {
                const parsed = parseStoredEvents(stored);
                if (parsed.length > lastIndex) {
                    const newEvents = parsed.slice(lastIndex);
                    for (const event of newEvents) {
                        safeEnqueue(event);
                    }
                    lastIndex = parsed.length;
                }
            };

            pollInterval = setInterval(async () => {
                if (streamClosed) return;
                try {
                    const status = queue.getStatus(id);

                    if (status && status !== lastSentStatus) {
                        safeEnqueue({ type: 'status', status });
                        lastSentStatus = status;
                    }

                    if (!status) {
                        const freshRun = await prisma.testRun.findUnique({
                            where: { id },
                            select: { status: true, error: true, result: true, logs: true }
                        });

                        if (!freshRun) return;

                        tryEnqueueStoredEvents(freshRun.result ?? freshRun.logs);

                        if (['PASS', 'FAIL', 'CANCELLED'].includes(freshRun.status)) {
                            if (pollInterval) {
                                clearInterval(pollInterval);
                            }

                            safeEnqueue({ type: 'status', status: freshRun.status, error: freshRun.error });
                            closeStream();
                            return;
                        }

                        if (['RUNNING', 'QUEUED', 'PREPARING'].includes(freshRun.status) && freshRun.status !== lastSentStatus) {
                            safeEnqueue({ type: 'status', status: freshRun.status });
                            lastSentStatus = freshRun.status;
                        }

                        return;
                    }

                    const events = queue.getEvents(id);
                    if (events.length > lastIndex) {
                        const newEvents = events.slice(lastIndex);
                        for (const event of newEvents) {
                            safeEnqueue(event);
                        }
                        lastIndex = events.length;
                    }

                } catch (error) {
                    if (!streamClosed) {
                        logger.warn('Streaming error', error);
                    }
                    closeStream();
                }
            }, appConfig.queue.pollInterval);

            ttlTimer = setTimeout(() => {
                closeStream();
            }, appConfig.queue.sseConnectionTtlMs);
        },
        cancel() {
            streamClosed = true;
            if (pollInterval) {
                clearInterval(pollInterval);
            }
            if (ttlTimer) {
                clearTimeout(ttlTimer);
                ttlTimer = null;
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
