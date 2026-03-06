import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { queue } from '@/lib/runtime/queue';
import { verifyAuth } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';

const logger = createLogger('api:test-runs:cancel');

export const dynamic = 'force-dynamic';

export async function POST(
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
                    include: { project: { select: { createdByUserId: true } } }
                }
            }
        });

        if (!testRun) {
            return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
        }

        if (testRun.testCase.project.createdByUserId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        await queue.cancel(id);

        const updated = await prisma.testRun.findUnique({ where: { id }, select: { status: true } });

        return NextResponse.json({ success: true, id: testRun.id, status: updated?.status || 'CANCELLED' });
    } catch (error) {
        logger.error('Failed to cancel test run', error);
        return NextResponse.json({ error: 'Failed to cancel test run' }, { status: 500 });
    }
}
