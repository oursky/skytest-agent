import { prisma } from '@/lib/core/prisma';
import { slackNotificationPolicy } from '@/lib/integrations/slack/config';
import { notifyRunTerminal } from '@/lib/integrations/slack/notifier';
import { TEST_STATUS } from '@/types';

export async function runSlackNotificationSweep(now = new Date()): Promise<{ scannedRuns: number }> {
    const staleBefore = new Date(now.getTime() - slackNotificationPolicy.sweepStabilityDelayMs);
    const newestCompletedAt = new Date(now.getTime() - slackNotificationPolicy.sweepMaxAgeMs);

    const candidates = await prisma.testRun.findMany({
        where: {
            status: {
                in: [TEST_STATUS.FAIL, TEST_STATUS.PASS],
            },
            slackNotifiedAt: null,
            slackNotifyAttempts: { lt: slackNotificationPolicy.maxAttempts },
            completedAt: {
                lt: staleBefore,
                gt: newestCompletedAt,
            },
        },
        orderBy: {
            completedAt: 'asc',
        },
        take: slackNotificationPolicy.sweepBatchSize,
        select: {
            id: true,
        },
    });

    for (const run of candidates) {
        await notifyRunTerminal(run.id);
    }

    return {
        scannedRuns: candidates.length,
    };
}
