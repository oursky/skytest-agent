import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { isProjectMember } from '@/lib/security/permissions';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { cancelLocalBrowserRun } from '@/lib/runtime/local-browser-runner';
import { dispatchNextQueuedBrowserRun } from '@/lib/runtime/browser-run-dispatcher';
import { ACTIVE_RUN_STATUSES } from '@/utils/status/statusHelpers';

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
        if (ACTIVE_RUN_STATUSES.includes(testRun.status)) {
            const completedAt = new Date();
            finalStatus = await prisma.$transaction(async (tx) => {
                const updateResult = await tx.testRun.updateMany({
                    where: {
                        id,
                        status: { in: [...ACTIVE_RUN_STATUSES] },
                    },
                    data: {
                        status: 'CANCELLED',
                        error: 'Cancelled by user',
                        completedAt,
                        assignedRunnerId: null,
                        leaseExpiresAt: null,
                    }
                });

                if (updateResult.count !== 1) {
                    const latestRun = await tx.testRun.findUnique({
                        where: { id },
                        select: { status: true },
                    });
                    return latestRun?.status ?? testRun.status;
                }

                await tx.testCase.update({
                    where: { id: testRun.testCaseId },
                    data: { status: 'CANCELLED' }
                });

                return 'CANCELLED';
            });

            if (finalStatus === 'CANCELLED') {
                publishRunUpdate(id);
            }
        }

        // Best-effort local abort for on-demand browser execution.
        cancelLocalBrowserRun(id);
        if (finalStatus === 'CANCELLED') {
            void dispatchNextQueuedBrowserRun().catch((dispatchError) => {
                logger.warn('Failed to dispatch queued browser run after cancellation', {
                    runId: id,
                    error: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
                });
            });
        }

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
