import { prisma } from '@/lib/core/prisma';
import { dispatchNextQueuedBrowserRun } from '@/lib/runtime/browser-run-dispatcher';
import { RUN_ACTIVE_STATUSES, TEST_STATUS, isRunTerminalStatus } from '@/types';

export async function cancelRunDurably(runId: string, errorMessage: string): Promise<boolean> {
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            status: true,
            testCaseId: true,
        },
    });

    if (!run) {
        return false;
    }

    if (isRunTerminalStatus(run.status)) {
        return false;
    }

    const completedAt = new Date();
    const cancelled = await prisma.$transaction(async (tx) => {
        const updateResult = await tx.testRun.updateMany({
            where: {
                id: runId,
                status: { in: [...RUN_ACTIVE_STATUSES] },
            },
            data: {
                status: TEST_STATUS.CANCELLED,
                error: errorMessage,
                completedAt,
                assignedRunnerId: null,
                leaseExpiresAt: null,
            },
        });

        if (updateResult.count === 0) {
            return false;
        }

        await tx.testCase.update({
            where: { id: run.testCaseId },
            data: { status: TEST_STATUS.CANCELLED },
        });

        await tx.androidResourceLock.deleteMany({
            where: {
                runId,
            },
        });

        return true;
    });
    if (!cancelled) {
        return false;
    }

    void dispatchNextQueuedBrowserRun().catch(() => {});

    return true;
}
