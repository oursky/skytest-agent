import { prisma } from '@/lib/core/prisma';

const ACTIVE_RUN_STATUSES = ['PREPARING', 'RUNNING'] as const;

export async function reapExpiredRunnerLeases(now = new Date()) {
    const expiredRuns = await prisma.testRun.findMany({
        where: {
            status: { in: [...ACTIVE_RUN_STATUSES] },
            leaseExpiresAt: { lt: now },
            assignedRunnerId: { not: null },
        },
        select: {
            id: true,
            testCaseId: true,
        },
    });

    if (expiredRuns.length === 0) {
        return { recoveredRuns: 0 };
    }

    const runIds = expiredRuns.map((run) => run.id);
    await prisma.testRun.updateMany({
        where: {
            id: { in: runIds },
        },
        data: {
            status: 'FAIL',
            error: 'Runner lease expired before completion',
            assignedRunnerId: null,
            leaseExpiresAt: null,
            completedAt: now,
        },
    });

    const testCaseIds = [...new Set(expiredRuns.map((run) => run.testCaseId))];
    if (testCaseIds.length > 0) {
        await prisma.testCase.updateMany({
            where: { id: { in: testCaseIds } },
            data: { status: 'FAIL' },
        });
    }

    return { recoveredRuns: expiredRuns.length };
}
