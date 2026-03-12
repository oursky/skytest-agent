import { prisma } from '@/lib/core/prisma';
import { dispatchQueuedBrowserRuns } from '@/lib/runtime/browser-run-dispatcher';

const ACTIVE_RUN_STATUSES = ['PREPARING', 'RUNNING'] as const;

export async function reapExpiredRunnerLeases(now = new Date()) {
    const expiredRuns = await prisma.testRun.findMany({
        where: {
            status: { in: [...ACTIVE_RUN_STATUSES] },
            deletedAt: null,
            leaseExpiresAt: { lt: now },
            assignedRunnerId: { not: null },
        },
        select: {
            id: true,
            testCaseId: true,
            status: true,
        },
    });

    if (expiredRuns.length === 0) {
        return { recoveredRuns: 0, requeuedRuns: 0, failedRuns: 0 };
    }

    const preparingRuns = expiredRuns.filter((run) => run.status === 'PREPARING');
    const runningRuns = expiredRuns.filter((run) => run.status === 'RUNNING');

    if (preparingRuns.length > 0) {
        await prisma.testRun.updateMany({
            where: {
                id: { in: preparingRuns.map((run) => run.id) },
                status: 'PREPARING',
            },
            data: {
                status: 'QUEUED',
                error: 'Runner lease expired during preparation; run re-queued',
                assignedRunnerId: null,
                leaseExpiresAt: null,
                startedAt: null,
            },
        });
    }

    if (runningRuns.length > 0) {
        await prisma.testRun.updateMany({
            where: {
                id: { in: runningRuns.map((run) => run.id) },
                status: 'RUNNING',
            },
            data: {
                status: 'FAIL',
                error: 'Runner lease expired before completion',
                assignedRunnerId: null,
                leaseExpiresAt: null,
                completedAt: now,
            },
        });
    }

    await prisma.androidResourceLock.deleteMany({
        where: {
            runId: { in: expiredRuns.map((run) => run.id) },
            run: {
                status: { notIn: [...ACTIVE_RUN_STATUSES] },
            },
        },
    });

    const preparingTestCaseIds = [...new Set(preparingRuns.map((run) => run.testCaseId))];
    if (preparingTestCaseIds.length > 0) {
        await prisma.testCase.updateMany({
            where: { id: { in: preparingTestCaseIds } },
            data: { status: 'QUEUED' },
        });
    }

    const runningTestCaseIds = [...new Set(runningRuns.map((run) => run.testCaseId))];
    if (runningTestCaseIds.length > 0) {
        await prisma.testCase.updateMany({
            where: { id: { in: runningTestCaseIds } },
            data: { status: 'FAIL' },
        });
    }

    void dispatchQueuedBrowserRuns(expiredRuns.length).catch(() => {});

    return {
        recoveredRuns: expiredRuns.length,
        requeuedRuns: preparingRuns.length,
        failedRuns: runningRuns.length,
    };
}
