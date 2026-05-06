import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    findManyRun,
    notifyRunTerminalMock,
} = vi.hoisted(() => ({
    findManyRun: vi.fn(),
    notifyRunTerminalMock: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findMany: findManyRun,
        },
    },
}));

vi.mock('@/lib/integrations/slack/notifier', () => ({
    notifyRunTerminal: notifyRunTerminalMock,
}));

const { runSlackNotificationSweep } = await import('@/lib/integrations/slack/sweep');

describe('runSlackNotificationSweep', () => {
    beforeEach(() => {
        findManyRun.mockReset();
        notifyRunTerminalMock.mockReset();
        findManyRun.mockResolvedValue([]);
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
                status: {
                    in: ['FAIL', 'PASS'],
                },
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
        expect(notifyRunTerminalMock).toHaveBeenNthCalledWith(1, 'run-1');
        expect(notifyRunTerminalMock).toHaveBeenNthCalledWith(2, 'run-2');
        expect(result).toEqual({ scannedRuns: 2 });
    });

    it('returns zero when no rows match sweep filters', async () => {
        const result = await runSlackNotificationSweep();

        expect(notifyRunTerminalMock).not.toHaveBeenCalled();
        expect(result).toEqual({ scannedRuns: 0 });
    });
});
