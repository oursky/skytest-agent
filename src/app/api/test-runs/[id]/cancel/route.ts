import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { isProjectMember } from '@/lib/security/permissions';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { cancelLocalBrowserRun } from '@/lib/runtime/local-browser-runner';

const logger = createLogger('api:test-runs:cancel');
const ACTIVE_RUN_STATUSES = ['QUEUED', 'PREPARING', 'RUNNING'] as const;

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
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const testRun = await prisma.testRun.findUnique({
            where: { id },
            include: {
                testCase: {
                    select: { projectId: true }
                }
            }
        });

        if (!testRun || testRun.deletedAt) {
            return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
        }

        if (!await isProjectMember(userId, testRun.testCase.projectId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        let finalStatus = testRun.status;
        if (ACTIVE_RUN_STATUSES.includes(testRun.status as typeof ACTIVE_RUN_STATUSES[number])) {
            const completedAt = new Date();
            await prisma.$transaction(async (tx) => {
                await tx.testRun.update({
                    where: { id },
                    data: {
                        status: 'CANCELLED',
                        error: 'Cancelled by user',
                        completedAt,
                        assignedRunnerId: null,
                        leaseExpiresAt: null,
                    }
                });
                await tx.testCase.update({
                    where: { id: testRun.testCaseId },
                    data: { status: 'CANCELLED' }
                });
            });
            finalStatus = 'CANCELLED';
            publishRunUpdate(id);
        }

        // Best-effort local abort for in-process execution. Worker-based runs
        // primarily rely on DB state + lease ownership updates.
        cancelLocalBrowserRun(id);

        logger.info('Cancelled test run', {
            runId: id,
            previousStatus: testRun.status,
            previousAssignedRunnerId: testRun.assignedRunnerId,
            finalStatus,
            cancelledByUserId: userId,
        });

        return NextResponse.json({ success: true, id: testRun.id, status: finalStatus });
    } catch (error) {
        logger.error('Failed to cancel test run', error);
        return NextResponse.json({ error: 'Failed to cancel test run' }, { status: 500 });
    }
}
