import { prisma } from '@/lib/core/prisma';
import { notifyRunFailed } from '@/lib/integrations/slack/notifier';
import { TEST_STATUS } from '@/types';

const DEFAULT_SWEEP_BATCH_SIZE = 25;
const DEFAULT_SWEEP_MAX_ATTEMPTS = 5;
const SLACK_SWEEP_STABILITY_DELAY_MS = 90_000;
const SLACK_SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

function parseBoundedInt(input: {
    value: string | undefined;
    fallback: number;
    min: number;
    max: number;
}): number {
    const parsed = Number.parseInt(input.value ?? '', 10);
    if (!Number.isFinite(parsed)) {
        return input.fallback;
    }

    return Math.min(input.max, Math.max(input.min, parsed));
}

function getSweepBatchSize(): number {
    return parseBoundedInt({
        value: process.env.SLACK_SWEEP_BATCH_SIZE,
        fallback: DEFAULT_SWEEP_BATCH_SIZE,
        min: 1,
        max: 200,
    });
}

function getSweepMaxAttempts(): number {
    return parseBoundedInt({
        value: process.env.SLACK_SWEEP_MAX_ATTEMPTS,
        fallback: DEFAULT_SWEEP_MAX_ATTEMPTS,
        min: 1,
        max: 50,
    });
}

export async function runSlackNotificationSweep(now = new Date()): Promise<{ scannedRuns: number }> {
    const staleBefore = new Date(now.getTime() - SLACK_SWEEP_STABILITY_DELAY_MS);
    const newestCompletedAt = new Date(now.getTime() - SLACK_SWEEP_MAX_AGE_MS);

    const candidates = await prisma.testRun.findMany({
        where: {
            status: TEST_STATUS.FAIL,
            slackNotifiedAt: null,
            slackNotifyAttempts: { lt: getSweepMaxAttempts() },
            completedAt: {
                lt: staleBefore,
                gt: newestCompletedAt,
            },
        },
        orderBy: {
            completedAt: 'asc',
        },
        take: getSweepBatchSize(),
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
