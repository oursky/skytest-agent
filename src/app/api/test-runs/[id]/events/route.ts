import { NextResponse } from 'next/server';
import { queue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const logger = createLogger('api:test-runs:events');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    const authPayload = await verifyAuth(request, token || undefined);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const testRun = await prisma.testRun.findUnique({
        where: { id },
        select: { status: true, result: true, logs: true }
    });

    if (!testRun) {
        return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
    }

    let pollInterval: ReturnType<typeof setInterval> | null = null;
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
                safeEnqueue({ type: 'status', status: testRun.status });

                const storedEvents = testRun.result ?? testRun.logs;
                if (storedEvents) {
                    try {
                        const events = JSON.parse(storedEvents);
                        if (Array.isArray(events)) {
                            for (const event of events) {
                                safeEnqueue(event);
                            }
                        }
                    } catch (error) {
                        logger.warn('Failed to parse stored events', error);
                    }
                }

                closeStream();
                return;
            }

            const currentStatus = queue.getStatus(id) ?? testRun.status;
            safeEnqueue({ type: 'status', status: currentStatus });

            let lastIndex = 0;
            let lastSentStatus = currentStatus;

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
                            select: { status: true, result: true }
                        });

                        if (!freshRun) return;

                        if (['PASS', 'FAIL', 'CANCELLED'].includes(freshRun.status)) {
                            if (pollInterval) {
                                clearInterval(pollInterval);
                            }

                            if (freshRun.result) {
                                try {
                                    const storedEvents = JSON.parse(freshRun.result);
                                    if (Array.isArray(storedEvents)) {
                                        const remainingEvents = storedEvents.slice(lastIndex);
                                        for (const event of remainingEvents) {
                                            safeEnqueue(event);
                                        }
                                    }
                                } catch (e) {
                                    logger.warn('Failed to parse stored events during completion', e);
                                }
                            }

                            safeEnqueue({ type: 'status', status: freshRun.status });
                            closeStream();
                            return;
                        }

                        if (['RUNNING', 'QUEUED'].includes(freshRun.status) && freshRun.status !== lastSentStatus) {
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
            }, 500);
        },
        cancel() {
            streamClosed = true;
            if (pollInterval) {
                clearInterval(pollInterval);
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
