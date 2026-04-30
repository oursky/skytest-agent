import { prisma } from '@/lib/core/prisma';
import { config as appConfig } from '@/config/app';
import { notifyRunFailed } from '@/lib/integrations/slack/notifier';
import { TEST_STATUS } from '@/types';

export async function runSlackNotificationSweep(now = new Date()): Promise<{ scannedRuns: number }> {
    const staleBefore = new Date(now.getTime() - appConfig.slack.notifications.sweepStabilityDelayMs);
    const newestCompletedAt = new Date(now.getTime() - appConfig.slack.notifications.sweepMaxAgeMs);

    const candidates = await prisma.testRun.findMany({
        where: {
            status: TEST_STATUS.FAIL,
            slackNotifiedAt: null,
            slackNotifyAttempts: { lt: appConfig.slack.notifications.maxAttempts },
            completedAt: {
                lt: staleBefore,
                gt: newestCompletedAt,
            },
        },
        orderBy: {
            completedAt: 'asc',
        },
        take: appConfig.slack.notifications.batchSize,
        select: {
            id: true,
        },
    });

    for (const run of candidates) {
        await notifyRunFailed(run.id);
    }

    return {
        scannedRuns: candidates.length,
    };
}
