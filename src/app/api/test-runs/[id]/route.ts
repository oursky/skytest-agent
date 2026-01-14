import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { queue } from '@/lib/queue';
import { verifyAuth } from '@/lib/auth';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;

        const testRun = await prisma.testRun.findUnique({
            where: { id },
            include: {
                files: true,
                testCase: {
                    select: {
                        id: true,
                        project: { select: { userId: true } }
                    }
                }
            }
        });

        if (!testRun) {
            return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
        }

        if (testRun.testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const files = testRun.files || [];

        return NextResponse.json({
            id: testRun.id,
            status: testRun.status,
            result: testRun.result,
            logs: testRun.logs,
            error: testRun.error,
            configurationSnapshot: testRun.configurationSnapshot,
            startedAt: testRun.startedAt,
            completedAt: testRun.completedAt,
            createdAt: testRun.createdAt,
            testCaseId: testRun.testCaseId,
            files
        });
    } catch (error) {
        console.error('Failed to fetch test run:', error);
        return NextResponse.json({ error: 'Failed to fetch test run' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;

        const testRun = await prisma.testRun.findUnique({
            where: { id },
            include: {
                testCase: {
                    include: { project: { select: { userId: true } } }
                }
            }
        });

        if (!testRun) {
            return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
        }

        if (testRun.testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        try {
            queue.cancel(id);
        } catch (e) {
            console.error('Failed to cancel job from queue:', e);
        }

        await prisma.testRun.delete({
            where: { id },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete test run:', error);
        return NextResponse.json({ error: 'Failed to delete test run' }, { status: 500 });
    }
}
