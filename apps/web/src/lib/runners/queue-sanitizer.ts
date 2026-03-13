import { prisma } from '@/lib/core/prisma';
import { TEST_STATUS } from '@/types';

const INVALID_ANDROID_QUEUE_ERROR = 'Android run is missing requestedDeviceId; please dispatch the run again.';

export async function failInvalidQueuedAndroidRuns(now = new Date()) {
    const result = await prisma.testRun.updateMany({
        where: {
            status: TEST_STATUS.QUEUED,
            deletedAt: null,
            assignedRunnerId: null,
            requiredCapability: 'ANDROID',
            requestedDeviceId: null,
        },
        data: {
            status: TEST_STATUS.FAIL,
            error: INVALID_ANDROID_QUEUE_ERROR,
            completedAt: now,
        },
    });

    return {
        failedRuns: result.count,
    };
}
