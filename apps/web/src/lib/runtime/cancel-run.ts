import { prisma } from '@/lib/core/prisma';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { recomputeRunSessionStatus } from '@/lib/runtime/run-session-service';
import { CANCELLATION_REASON } from '@/lib/runtime/cancellation-reasons';
import { RUN_ACTIVE_STATUSES, RUN_SESSION_KIND, TEST_STATUS, isRunActiveStatus } from '@/types';

export interface CancelTestRunResult {
    id: string;
    previousStatus: string;
    previousAssignedRunnerId: string | null;
    finalStatus: string;
    cancelled: boolean;
}

/**
 * Cancels a single test run if it is still active, mirroring the queue/runner
 * teardown the lease reaper performs: the run and its test case are marked
 * CANCELLED, the runner lease is released, and Android resource locks are freed.
 * Returns null when the run does not exist (or is soft-deleted). Shared by the
 * per-run cancel route and the run-session cancel route so both paths transition
 * identically.
 */
export async function cancelActiveTestRun(
    runId: string,
    reason: string = CANCELLATION_REASON.USER_SINGLE,
): Promise<CancelTestRunResult | null> {
    const testRun = await prisma.testRun.findUnique({
        where: { id: runId },
        select: { id: true, status: true, testCaseId: true, assignedRunnerId: true, deletedAt: true },
    });

    if (!testRun || testRun.deletedAt) {
        return null;
    }

    let finalStatus = testRun.status;
    if (isRunActiveStatus(testRun.status)) {
        const completedAt = new Date();
        finalStatus = await prisma.$transaction(async (tx) => {
            const updateResult = await tx.testRun.updateMany({
                where: {
                    id: runId,
                    status: { in: [...RUN_ACTIVE_STATUSES] },
                },
                data: {
                    status: TEST_STATUS.CANCELLED,
                    error: reason,
                    completedAt,
                    assignedRunnerId: null,
                    leaseExpiresAt: null,
                },
            });

            if (updateResult.count !== 1) {
                const latestRun = await tx.testRun.findUnique({
                    where: { id: runId },
                    select: { status: true },
                });
                return latestRun?.status ?? testRun.status;
            }

            await tx.testCase.update({
                where: { id: testRun.testCaseId },
                data: { status: TEST_STATUS.CANCELLED },
            });

            await tx.androidResourceLock.deleteMany({
                where: { runId },
            });

            return TEST_STATUS.CANCELLED;
        });

        if (finalStatus === TEST_STATUS.CANCELLED) {
            publishRunUpdate(runId);
        }
    }

    return {
        id: runId,
        previousStatus: testRun.status,
        previousAssignedRunnerId: testRun.assignedRunnerId,
        finalStatus,
        cancelled: finalStatus === TEST_STATUS.CANCELLED,
    };
}

/**
 * Cancels every still-active member of a run session, then rolls up the session status.
 * Used so that stopping any one member (e.g. a login flow that runs before the test)
 * cancels the whole run the user triggered — siblings and the test all settle CANCELLED
 * rather than being left queued.
 */
export async function cancelActiveRunSession(sessionId: string): Promise<{ cancelledMembers: number }> {
    const session = await prisma.runSession.findUnique({
        where: { id: sessionId },
        select: {
            kind: true,
            memberRuns: {
                where: { status: { in: [...RUN_ACTIVE_STATUSES] } },
                select: { id: true },
            },
        },
    });

    const reason = session?.kind === RUN_SESSION_KIND.GROUP
        ? CANCELLATION_REASON.USER_GROUP
        : CANCELLATION_REASON.USER_SINGLE;

    let cancelledMembers = 0;
    for (const member of session?.memberRuns ?? []) {
        const result = await cancelActiveTestRun(member.id, reason);
        if (result?.cancelled) {
            cancelledMembers += 1;
        }
    }

    await recomputeRunSessionStatus(sessionId);
    return { cancelledMembers };
}
