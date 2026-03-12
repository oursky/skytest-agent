import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    findMany,
    updateManyRuns,
    updateManyTestCases,
    deleteManyLocks,
    dispatchQueuedBrowserRuns,
} = vi.hoisted(() => ({
    findMany: vi.fn(),
    updateManyRuns: vi.fn(),
    updateManyTestCases: vi.fn(),
    deleteManyLocks: vi.fn(),
    dispatchQueuedBrowserRuns: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findMany,
            updateMany: updateManyRuns,
        },
        testCase: {
            updateMany: updateManyTestCases,
        },
        androidResourceLock: {
            deleteMany: deleteManyLocks,
        },
    },
}));

vi.mock('@/lib/runtime/browser-run-dispatcher', () => ({
    dispatchQueuedBrowserRuns,
}));

const { reapExpiredRunnerLeases } = await import('@/lib/runners/lease-reaper');

describe('reapExpiredRunnerLeases', () => {
    beforeEach(() => {
        findMany.mockReset();
        updateManyRuns.mockReset();
        updateManyTestCases.mockReset();
        deleteManyLocks.mockReset();
        dispatchQueuedBrowserRuns.mockReset();
        dispatchQueuedBrowserRuns.mockResolvedValue(0);
    });

    it('requeues PREPARING runs and fails RUNNING runs when leases expire', async () => {
        const now = new Date('2026-03-07T05:00:00.000Z');
        findMany.mockResolvedValueOnce([
            { id: 'run-1', testCaseId: 'tc-1', status: 'PREPARING' },
            { id: 'run-2', testCaseId: 'tc-2', status: 'RUNNING' },
        ]);

        const result = await reapExpiredRunnerLeases(now);

        expect(updateManyRuns).toHaveBeenNthCalledWith(1, {
            where: {
                id: { in: ['run-1'] },
                status: 'PREPARING',
            },
            data: {
                status: 'QUEUED',
                error: 'Runner lease expired during preparation; run re-queued',
                assignedRunnerId: null,
                leaseExpiresAt: null,
                startedAt: null,
            },
        });
        expect(updateManyRuns).toHaveBeenNthCalledWith(2, {
            where: {
                id: { in: ['run-2'] },
                status: 'RUNNING',
            },
            data: {
                status: 'FAIL',
                error: 'Runner lease expired before completion',
                assignedRunnerId: null,
                leaseExpiresAt: null,
                completedAt: now,
            },
        });
        expect(updateManyTestCases).toHaveBeenNthCalledWith(1, {
            where: { id: { in: ['tc-1'] } },
            data: { status: 'QUEUED' },
        });
        expect(updateManyTestCases).toHaveBeenNthCalledWith(2, {
            where: { id: { in: ['tc-2'] } },
            data: { status: 'FAIL' },
        });
        expect(deleteManyLocks).toHaveBeenCalledWith({
            where: {
                runId: { in: ['run-1', 'run-2'] },
                run: {
                    status: { notIn: ['PREPARING', 'RUNNING'] },
                },
            },
        });
        expect(dispatchQueuedBrowserRuns).toHaveBeenCalledWith(2);
        expect(result).toEqual({ recoveredRuns: 2, requeuedRuns: 1, failedRuns: 1 });
    });

    it('does nothing when no expired runs are found', async () => {
        findMany.mockResolvedValueOnce([]);

        const result = await reapExpiredRunnerLeases();

        expect(updateManyRuns).not.toHaveBeenCalled();
        expect(updateManyTestCases).not.toHaveBeenCalled();
        expect(deleteManyLocks).not.toHaveBeenCalled();
        expect(dispatchQueuedBrowserRuns).not.toHaveBeenCalled();
        expect(result).toEqual({ recoveredRuns: 0, requeuedRuns: 0, failedRuns: 0 });
    });
});
