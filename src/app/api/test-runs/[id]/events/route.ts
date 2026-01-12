
import { NextResponse } from 'next/server';
import { queue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';

import { verifyAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

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

    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const encode = (data: any) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

            if (['PASS', 'FAIL', 'CANCELLED'].includes(testRun.status)) {
                controller.enqueue(encode({ type: 'status', status: testRun.status }));

                if (testRun.result) {
                    try {
                        const events = JSON.parse(testRun.result);
                        if (Array.isArray(events)) {
                            for (const event of events) {
                                controller.enqueue(encode(event));
                            }
                        }
                    } catch (e) {
                    }
                } else if (testRun.logs) {
                    try {
                        const logs = JSON.parse(testRun.logs);
                        if (Array.isArray(logs)) {
                            for (const event of logs) {
                                controller.enqueue(encode(event));
                            }
                        }
                    } catch (e) { }
                }

                controller.close();
                return;
            }

            const checkInitialStatus = async () => {
                const currentQueueStatus = queue.getStatus(id);
                if (currentQueueStatus) {
                    controller.enqueue(encode({ type: 'status', status: testRun.status }));
                } else {
                    controller.enqueue(encode({ type: 'status', status: testRun.status }));
                }
            };

            checkInitialStatus();

            let lastIndex = 0;
            const pollInterval = setInterval(async () => {
                try {
                    const status = queue.getStatus(id);

                    if (!status) {
                        const freshRun = await prisma.testRun.findUnique({ where: { id }, select: { status: true, result: true } });
                        if (freshRun && ['PASS', 'FAIL', 'CANCELLED'].includes(freshRun.status)) {
                            clearInterval(pollInterval);
                            controller.enqueue(encode({ type: 'status', status: freshRun.status }));
                            controller.close();
                            return;
                        }

                        if (freshRun && ['RUNNING', 'QUEUED'].includes(freshRun.status)) {
                            console.warn(`Detected orphaned run ${id} in DB. Marking as FAILED.`);

                            await prisma.testRun.update({
                                where: { id },
                                data: {
                                    status: 'FAIL',
                                    error: 'Test execution interrupted (Server restarted or proces lost)',
                                    completedAt: new Date()
                                }
                            });

                            clearInterval(pollInterval);
                            controller.enqueue(encode({
                                type: 'status',
                                status: 'FAIL',
                                error: 'Test execution interrupted (Server restarted or proces lost)'
                            }));
                            controller.close();
                            return;
                        }

                        return;
                    }

                    const events = queue.getEvents(id);
                    if (events.length > lastIndex) {
                        const newEvents = events.slice(lastIndex);
                        for (const event of newEvents) {
                            controller.enqueue(encode(event));
                        }
                        lastIndex = events.length;
                    }

                } catch (e) {
                    console.error('Streaming error', e);
                    clearInterval(pollInterval);
                    controller.close();
                }
            }, 500);

            return () => {
                clearInterval(pollInterval);
            };
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
