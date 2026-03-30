import { config as appConfig } from '@/config/app';
import { prisma } from '@/lib/core/prisma';
import { BROWSER_EXECUTION_CAPABILITY } from '@/lib/runners/constants';
import { RUN_IN_PROGRESS_STATUSES, TEST_STATUS } from '@/types';

export async function reapExpiredRunnerLeases(now = new Date()) {
    await prisma.androidResourceLock.deleteMany({
        where: {
            OR: [
                { leaseExpiresAt: { lte: now } },
                {
                    run: {
                        deletedAt: { not: null },
                    },
                },
                {
                    run: {
                        status: { notIn: [...RUN_IN_PROGRESS_STATUSES] },
                    },
                },
            ],
        },
    });

    const expiredRuns = await prisma.testRun.findMany({
        where: {
            status: { in: [...RUN_IN_PROGRESS_STATUSES] },
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

    const preparingRuns = expiredRuns.filter((run) => run.status === TEST_STATUS.PREPARING);
    const runningRuns = expiredRuns.filter((run) => run.status === TEST_STATUS.RUNNING);

    if (preparingRuns.length > 0) {
        await prisma.testRun.updateMany({
            where: {
                id: { in: preparingRuns.map((run) => run.id) },
                status: TEST_STATUS.PREPARING,
            },
            data: {
                status: TEST_STATUS.QUEUED,
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
                status: TEST_STATUS.RUNNING,
            },
            data: {
                status: TEST_STATUS.FAIL,
                error: 'Runner lease expired before completion',
                assignedRunnerId: null,
                leaseExpiresAt: null,
                completedAt: now,
            },
        });
    }

    const preparingTestCaseIds = [...new Set(preparingRuns.map((run) => run.testCaseId))];
    if (preparingTestCaseIds.length > 0) {
        await prisma.testCase.updateMany({
            where: { id: { in: preparingTestCaseIds } },
            data: { status: TEST_STATUS.QUEUED },
        });
    }

    const runningTestCaseIds = [...new Set(runningRuns.map((run) => run.testCaseId))];
    if (runningTestCaseIds.length > 0) {
        await prisma.testCase.updateMany({
            where: { id: { in: runningTestCaseIds } },
            data: { status: TEST_STATUS.FAIL },
        });
    }

    return {
        recoveredRuns: expiredRuns.length,
        requeuedRuns: preparingRuns.length,
        failedRuns: runningRuns.length,
    };
}

export async function reapStaleLocalBrowserRuns(now = new Date()) {
    const staleBefore = new Date(now.getTime() - appConfig.runner.localBrowserStaleTimeoutMs);
    const staleRuns = await prisma.testRun.findMany({
        where: {
            status: { in: [...RUN_IN_PROGRESS_STATUSES] },
            deletedAt: null,
            assignedRunnerId: null,
            requiredCapability: BROWSER_EXECUTION_CAPABILITY,
            OR: [
                { lastEventAt: { lt: staleBefore } },
                {
                    lastEventAt: null,
                    startedAt: { lt: staleBefore },
                },
            ],
        },
        select: {
            id: true,
            testCaseId: true,
            status: true,
        },
    });

    if (staleRuns.length === 0) {
        return {
            recoveredRuns: 0,
            requeuedRuns: 0,
            failedRuns: 0,
            staleBefore,
        };
    }

    const preparingRuns = staleRuns.filter((run) => run.status === TEST_STATUS.PREPARING);
    const runningRuns = staleRuns.filter((run) => run.status === TEST_STATUS.RUNNING);

    if (preparingRuns.length > 0) {
        await prisma.testRun.updateMany({
            where: {
                id: { in: preparingRuns.map((run) => run.id) },
                status: TEST_STATUS.PREPARING,
                assignedRunnerId: null,
                requiredCapability: BROWSER_EXECUTION_CAPABILITY,
            },
            data: {
                status: TEST_STATUS.QUEUED,
                error: 'Local browser run became stale during preparation; run re-queued',
                startedAt: null,
            },
        });
    }

    if (runningRuns.length > 0) {
        await prisma.testRun.updateMany({
            where: {
                id: { in: runningRuns.map((run) => run.id) },
                status: TEST_STATUS.RUNNING,
                assignedRunnerId: null,
                requiredCapability: BROWSER_EXECUTION_CAPABILITY,
            },
            data: {
                status: TEST_STATUS.FAIL,
                error: 'Local browser run became stale before completion',
                completedAt: now,
            },
        });
    }

    const preparingTestCaseIds = [...new Set(preparingRuns.map((run) => run.testCaseId))];
    if (preparingTestCaseIds.length > 0) {
        await prisma.testCase.updateMany({
            where: { id: { in: preparingTestCaseIds } },
            data: { status: TEST_STATUS.QUEUED },
        });
    }

    const runningTestCaseIds = [...new Set(runningRuns.map((run) => run.testCaseId))];
    if (runningTestCaseIds.length > 0) {
        await prisma.testCase.updateMany({
            where: { id: { in: runningTestCaseIds } },
            data: { status: TEST_STATUS.FAIL },
        });
    }

    return {
        recoveredRuns: staleRuns.length,
        requeuedRuns: preparingRuns.length,
        failedRuns: runningRuns.length,
        staleBefore,
    };
}
