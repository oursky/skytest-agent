import { prisma } from '@/lib/core/prisma';
import { emitRunTerminal } from '@/lib/runners/domain-events';
import { TEST_STATUS } from '@/types';

const INVALID_ANDROID_QUEUE_ERROR = 'Android run is missing requestedDeviceId; please dispatch the run again.';

export async function failInvalidQueuedAndroidRuns(now = new Date()) {
    const invalidRuns = await prisma.testRun.findMany({
        where: {
            status: TEST_STATUS.QUEUED,
            deletedAt: null,
            assignedRunnerId: null,
            requiredCapability: 'ANDROID',
            requestedDeviceId: null,
        },
        select: {
            id: true,
            testCaseId: true,
        },
    });

    if (invalidRuns.length === 0) {
        return {
            failedRuns: 0,
        };
    }

    const result = await prisma.testRun.updateMany({
        where: {
            id: {
                in: invalidRuns.map((run) => run.id),
            },
            status: TEST_STATUS.QUEUED,
        },
        data: {
            status: TEST_STATUS.FAIL,
            error: INVALID_ANDROID_QUEUE_ERROR,
            completedAt: now,
        },
    });

    if (result.count > 0) {
        const transitionedRuns = await prisma.testRun.findMany({
            where: {
                id: { in: invalidRuns.map((run) => run.id) },
                status: TEST_STATUS.FAIL,
                error: INVALID_ANDROID_QUEUE_ERROR,
                completedAt: now,
            },
            select: {
                id: true,
                testCaseId: true,
            },
        });

        for (const run of transitionedRuns) {
            emitRunTerminal({
                runId: run.id,
                status: TEST_STATUS.FAIL,
                testCaseId: run.testCaseId,
            });
        }
    }

    return {
        failedRuns: result.count,
    };
}
