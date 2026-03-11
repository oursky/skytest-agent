import { prisma } from '@/lib/core/prisma';
import { dispatchNextQueuedBrowserRun } from '@/lib/runtime/browser-run-dispatcher';
import { ACTIVE_RUN_STATUSES } from '@/utils/status/statusHelpers';

const TERMINAL_RUN_STATUSES = new Set(['PASS', 'FAIL', 'CANCELLED']);

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

    if (TERMINAL_RUN_STATUSES.has(run.status)) {
        return false;
    }

    const completedAt = new Date();
    const updateResult = await prisma.testRun.updateMany({
        where: {
            id: runId,
            status: { in: [...ACTIVE_RUN_STATUSES] },
        },
        data: {
            status: 'CANCELLED',
            error: errorMessage,
            completedAt,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        },
    });

    if (updateResult.count === 0) {
        return false;
    }

    await prisma.testCase.update({
        where: { id: run.testCaseId },
        data: { status: 'CANCELLED' },
    });

    void dispatchNextQueuedBrowserRun().catch(() => {});

    return true;
}
