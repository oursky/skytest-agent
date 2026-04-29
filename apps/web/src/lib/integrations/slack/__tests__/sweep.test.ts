import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    findManyRun,
    notifyRunFailedMock,
} = vi.hoisted(() => ({
    findManyRun: vi.fn(),
    notifyRunFailedMock: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findMany: findManyRun,
        },
    },
}));

vi.mock('@/lib/integrations/slack/notifier', () => ({
    notifyRunFailed: notifyRunFailedMock,
}));

const { runSlackNotificationSweep } = await import('@/lib/integrations/slack/sweep');

describe('runSlackNotificationSweep', () => {
    beforeEach(() => {
        findManyRun.mockReset();
        notifyRunFailedMock.mockReset();
        findManyRun.mockResolvedValue([]);
        vi.stubEnv('SLACK_SWEEP_BATCH_SIZE', '25');
        vi.stubEnv('SLACK_SWEEP_MAX_ATTEMPTS', '5');
    });

    it('queries stale failed runs and forwards each run id to notifier', async () => {
        const now = new Date('2026-04-29T12:00:00.000Z');
        findManyRun.mockResolvedValueOnce([
            { id: 'run-1' },
            { id: 'run-2' },
        ]);

        const result = await runSlackNotificationSweep(now);

        expect(findManyRun).toHaveBeenCalledWith({
            where: {
                status: 'FAIL',
                slackNotifiedAt: null,
                slackNotifyAttempts: { lt: 5 },
                completedAt: {
                    lt: new Date('2026-04-29T11:58:30.000Z'),
                    gt: new Date('2026-04-28T12:00:00.000Z'),
                },
            },
            orderBy: {
                completedAt: 'asc',
            },
            take: 25,
            select: {
                id: true,
            },
        });
        expect(notifyRunFailedMock).toHaveBeenNthCalledWith(1, 'run-1');
        expect(notifyRunFailedMock).toHaveBeenNthCalledWith(2, 'run-2');
        expect(result).toEqual({ scannedRuns: 2 });
    });

    it('returns zero when no rows match sweep filters', async () => {
        const result = await runSlackNotificationSweep();

        expect(notifyRunFailedMock).not.toHaveBeenCalled();
        expect(result).toEqual({ scannedRuns: 0 });
    });
});
