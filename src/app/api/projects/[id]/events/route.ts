import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { subscribeProjectEvents } from '@/lib/project-events';
import { verifyStreamToken } from '@/lib/stream-token';
import { config as appConfig } from '@/config/app';

export const dynamic = 'force-dynamic';

const logger = createLogger('api:projects:events');

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
            scope: 'project-events',
            resourceId: id
        });
        userId = streamIdentity?.userId ?? null;
    }

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
    let ttlTimer: ReturnType<typeof setTimeout> | null = null;

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

            ttlTimer = setTimeout(() => {
                cleanup();
            }, appConfig.queue.sseConnectionTtlMs);
        },
        cancel() {
            if (streamClosed) return;
            streamClosed = true;
            if (heartbeat) {
                clearInterval(heartbeat);
                heartbeat = null;
            }
            if (ttlTimer) {
                clearTimeout(ttlTimer);
                ttlTimer = null;
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
