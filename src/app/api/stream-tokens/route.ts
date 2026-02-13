import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { issueStreamToken, StreamScope } from '@/lib/stream-token';

const logger = createLogger('api:stream-tokens');

interface StreamTokenRequestBody {
    scope?: unknown;
    resourceId?: unknown;
}

function isStreamScope(value: unknown): value is StreamScope {
    return value === 'project-events' || value === 'test-run-events' || value === 'test-case-files';
}

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: StreamTokenRequestBody;
    try {
        body = await request.json() as StreamTokenRequestBody;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!isStreamScope(body.scope)) {
        return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
    }
    if (typeof body.resourceId !== 'string' || body.resourceId.length === 0) {
        return NextResponse.json({ error: 'Invalid resourceId' }, { status: 400 });
    }

    try {
        if (body.scope === 'project-events') {
            const project = await prisma.project.findUnique({
                where: { id: body.resourceId },
                select: { userId: true }
            });
            if (!project) {
                return NextResponse.json({ error: 'Project not found' }, { status: 404 });
            }
            if (project.userId !== userId) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        } else if (body.scope === 'test-run-events') {
            const testRun = await prisma.testRun.findUnique({
                where: { id: body.resourceId },
                select: {
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
        } else {
            const testCase = await prisma.testCase.findUnique({
                where: { id: body.resourceId },
                select: {
                    project: { select: { userId: true } }
                }
            });
            if (!testCase) {
                return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
            }
            if (testCase.project.userId !== userId) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const streamToken = await issueStreamToken({
            userId,
            scope: body.scope,
            resourceId: body.resourceId
        });

        return NextResponse.json({ streamToken });
    } catch (error) {
        logger.error('Failed to issue stream token', error);
        return NextResponse.json({ error: 'Failed to issue stream token' }, { status: 500 });
    }
}
