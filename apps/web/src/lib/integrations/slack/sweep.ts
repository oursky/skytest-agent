import { prisma } from '@/lib/core/prisma';
import { config as appConfig } from '@/config/app';
import { notifyRunFailed } from '@/lib/integrations/slack/notifier';
import { TEST_STATUS } from '@/types';

const SLACK_SWEEP_STABILITY_DELAY_MS = 90_000;
const SLACK_SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export async function runSlackNotificationSweep(now = new Date()): Promise<{ scannedRuns: number }> {
    const staleBefore = new Date(now.getTime() - SLACK_SWEEP_STABILITY_DELAY_MS);
    const newestCompletedAt = new Date(now.getTime() - SLACK_SWEEP_MAX_AGE_MS);

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
