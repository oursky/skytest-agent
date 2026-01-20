import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { subscribeProjectEvents } from '@/lib/project-events';

export const dynamic = 'force-dynamic';

const logger = createLogger('api:projects:events');

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

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const project = await prisma.project.findUnique({ where: { id }, select: { userId: true } });
    if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.userId !== userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let streamClosed = false;
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            const encode = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

            const cleanup = () => {
                if (streamClosed) return;
                streamClosed = true;
                if (heartbeat) {
                    clearInterval(heartbeat);
                    heartbeat = null;
                }
                if (unsubscribe) {
                    unsubscribe();
                    unsubscribe = null;
                }
                try {
                    controller.close();
                } catch {
                    // ignore
                }
            };

            const safeEnqueue = (data: unknown) => {
                if (streamClosed) return;
                try {
                    controller.enqueue(encode(data));
                } catch (error) {
                    logger.debug('Stream enqueue failed', error);
                    cleanup();
                }
            };

            safeEnqueue({ type: 'connected' });

            unsubscribe = subscribeProjectEvents(id, (event) => {
                safeEnqueue(event);
            });

            heartbeat = setInterval(() => {
                if (streamClosed) return;
                try {
                    controller.enqueue(encoder.encode(`: ping\n\n`));
                } catch {
                    cleanup();
                }
            }, 15000);
        },
        cancel() {
            if (streamClosed) return;
            streamClosed = true;
            if (heartbeat) {
                clearInterval(heartbeat);
                heartbeat = null;
            }
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        },
    });
}
