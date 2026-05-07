import { prisma } from '@/lib/core/prisma';
import { slackNotificationPolicy } from '@/lib/integrations/slack/config';
import { notifyRunTerminal, SLACK_NOTIFY_OUTCOME } from '@/lib/integrations/slack/notifier';
import { TEST_STATUS } from '@/types';

export interface SlackNotificationSweepResult {
    scannedRuns: number;
    notifiedRuns: number;
    retryPendingRuns: number;
    exhaustedRuns: number;
    skippedRuns: number;
}

export async function runSlackNotificationSweep(now = new Date()): Promise<SlackNotificationSweepResult> {
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

    let notifiedRuns = 0;
    let retryPendingRuns = 0;
    let exhaustedRuns = 0;
    let skippedRuns = 0;

    for (const run of candidates) {
        const outcome = await notifyRunTerminal(run.id);
        if (outcome === SLACK_NOTIFY_OUTCOME.NOTIFIED) {
            notifiedRuns += 1;
            continue;
        }
        if (outcome === SLACK_NOTIFY_OUTCOME.RETRY_PENDING) {
            retryPendingRuns += 1;
            continue;
        }
        if (outcome === SLACK_NOTIFY_OUTCOME.EXHAUSTED) {
            exhaustedRuns += 1;
            continue;
        }
        skippedRuns += 1;
    }

    return {
        scannedRuns: candidates.length,
        notifiedRuns,
        retryPendingRuns,
        exhaustedRuns,
        skippedRuns,
    };
}
