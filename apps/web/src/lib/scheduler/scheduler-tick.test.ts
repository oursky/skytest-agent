import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    queryRaw: vi.fn(),
    scheduleTestCaseFindMany: vi.fn(),
    scheduleRunGroupFindMany: vi.fn(),
    scheduleUpdate: vi.fn(),
    transaction: vi.fn(),
    queueTestCaseRun: vi.fn(),
    queueRunGroupRun: vi.fn(),
    computeNextRunAt: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        $queryRaw: mocks.queryRaw,
        $transaction: mocks.transaction,
    },
}));

vi.mock('@/lib/mcp/run-execution', () => ({
    queueTestCaseRun: mocks.queueTestCaseRun,
}));

vi.mock('@/lib/run-groups/run-group-service', () => ({
    queueRunGroupRun: mocks.queueRunGroupRun,
}));

vi.mock('@/lib/scheduler/cron', () => ({
    computeNextRunAt: mocks.computeNextRunAt,
}));

const { runSchedulerTick } = await import('@/lib/scheduler/scheduler-tick');

describe('runSchedulerTick', () => {
    beforeEach(() => {
        mocks.queryRaw.mockReset();
        mocks.scheduleTestCaseFindMany.mockReset();
        mocks.scheduleRunGroupFindMany.mockReset();
        mocks.scheduleRunGroupFindMany.mockResolvedValue([]);
        mocks.scheduleUpdate.mockReset();
        mocks.transaction.mockReset();
        mocks.queueTestCaseRun.mockReset();
        mocks.queueRunGroupRun.mockReset();
        mocks.computeNextRunAt.mockReset();

        mocks.transaction.mockImplementation(async (callback: (tx: {
            $queryRaw: typeof mocks.queryRaw;
            scheduleTestCase: { findMany: typeof mocks.scheduleTestCaseFindMany };
            scheduleRunGroup: { findMany: typeof mocks.scheduleRunGroupFindMany };
            schedule: { update: typeof mocks.scheduleUpdate };
        }) => Promise<unknown>) => callback({
            $queryRaw: mocks.queryRaw,
            scheduleTestCase: { findMany: mocks.scheduleTestCaseFindMany },
            scheduleRunGroup: { findMany: mocks.scheduleRunGroupFindMany },
            schedule: { update: mocks.scheduleUpdate },
        }));
        mocks.computeNextRunAt.mockReturnValue(new Date('2026-06-09T09:00:00.000Z'));
    });

    it('claims due schedules and enqueues each linked test case', async () => {
        mocks.queryRaw
            .mockResolvedValueOnce([
                {
                    id: 'schedule-1',
                    cronExpression: '0 9 * * *',
                    timezone: 'Etc/UTC',
                    createdByUserId: 'user-1',
                },
            ])
            .mockResolvedValueOnce([]);
        mocks.scheduleTestCaseFindMany.mockResolvedValueOnce([
            { testCaseId: 'tc-1' },
            { testCaseId: 'tc-2' },
        ]);
        mocks.scheduleUpdate.mockResolvedValue({ id: 'schedule-1' });
        mocks.queueTestCaseRun.mockResolvedValue({ ok: true, data: { runId: 'run-1' } });

        const result = await runSchedulerTick(5);

        expect(result).toEqual({
            claimedSchedules: 1,
            enqueuedRuns: 2,
            failedRuns: 0,
        });
        expect(mocks.scheduleUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.queueTestCaseRun).toHaveBeenCalledTimes(2);
        expect(mocks.queueTestCaseRun.mock.calls[0]?.[3]).toEqual({ source: 'SCHEDULER' });
    });

    it('tracks enqueue failures without aborting the tick', async () => {
        mocks.queryRaw
            .mockResolvedValueOnce([
                {
                    id: 'schedule-1',
                    cronExpression: '0 9 * * *',
                    timezone: 'Etc/UTC',
                    createdByUserId: 'user-1',
                },
            ])
            .mockResolvedValueOnce([]);
        mocks.scheduleTestCaseFindMany.mockResolvedValueOnce([
            { testCaseId: 'tc-1' },
            { testCaseId: 'tc-2' },
        ]);
        mocks.scheduleUpdate.mockResolvedValue({ id: 'schedule-1' });
        mocks.queueTestCaseRun
            .mockResolvedValueOnce({ ok: false, failure: { error: 'Forbidden' } })
            .mockResolvedValueOnce({ ok: true, data: { runId: 'run-2' } });

        const result = await runSchedulerTick(1);

        expect(result).toEqual({
            claimedSchedules: 1,
            enqueuedRuns: 1,
            failedRuns: 1,
        });
    });

    it('disables a schedule whose next run cannot be computed and keeps processing the tick', async () => {
        mocks.queryRaw
            .mockResolvedValueOnce([
                {
                    id: 'schedule-poison',
                    cronExpression: 'not-a-cron',
                    timezone: 'UTC',
                    createdByUserId: 'user-1',
                },
            ])
            .mockResolvedValueOnce([
                {
                    id: 'schedule-1',
                    cronExpression: '0 9 * * *',
                    timezone: 'Etc/UTC',
                    createdByUserId: 'user-1',
                },
            ])
            .mockResolvedValueOnce([]);
        mocks.computeNextRunAt
            .mockImplementationOnce(() => {
                throw new Error('cannot find next');
            })
            .mockReturnValueOnce(new Date('2026-06-09T09:00:00.000Z'));
        mocks.scheduleTestCaseFindMany.mockResolvedValueOnce([{ testCaseId: 'tc-1' }]);
        mocks.scheduleUpdate.mockResolvedValue({ id: 'schedule-1' });
        mocks.queueTestCaseRun.mockResolvedValue({ ok: true, data: { runId: 'run-1' } });

        const result = await runSchedulerTick(5);

        expect(result).toEqual({
            claimedSchedules: 1,
            enqueuedRuns: 1,
            failedRuns: 0,
        });
        expect(mocks.scheduleUpdate).toHaveBeenCalledWith({
            where: { id: 'schedule-poison' },
            data: { enabled: false, nextRunAt: null },
        });
        expect(mocks.queueTestCaseRun).toHaveBeenCalledTimes(1);
    });
});
