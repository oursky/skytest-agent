import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    findMany,
    updateManyRuns,
    updateManyTestCases,
} = vi.hoisted(() => ({
    findMany: vi.fn(),
    updateManyRuns: vi.fn(),
    updateManyTestCases: vi.fn(),
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
    },
}));

const { reapExpiredRunnerLeases } = await import('@/lib/runners/lease-reaper');

describe('reapExpiredRunnerLeases', () => {
    beforeEach(() => {
        findMany.mockReset();
        updateManyRuns.mockReset();
        updateManyTestCases.mockReset();
    });

    it('marks expired claimed runs as failed', async () => {
        const now = new Date('2026-03-07T05:00:00.000Z');
        findMany.mockResolvedValueOnce([
            { id: 'run-1', testCaseId: 'tc-1' },
            { id: 'run-2', testCaseId: 'tc-2' },
        ]);

        const result = await reapExpiredRunnerLeases(now);

        expect(updateManyRuns).toHaveBeenCalledWith({
            where: {
                id: { in: ['run-1', 'run-2'] },
            },
            data: {
                status: 'FAIL',
                error: 'Runner lease expired before completion',
                assignedRunnerId: null,
                leaseExpiresAt: null,
                completedAt: now,
            },
        });
        expect(updateManyTestCases).toHaveBeenCalledWith({
            where: { id: { in: ['tc-1', 'tc-2'] } },
            data: { status: 'FAIL' },
        });
        expect(result).toEqual({ recoveredRuns: 2 });
    });

    it('does nothing when no expired runs are found', async () => {
        findMany.mockResolvedValueOnce([]);

        const result = await reapExpiredRunnerLeases();

        expect(updateManyRuns).not.toHaveBeenCalled();
        expect(updateManyTestCases).not.toHaveBeenCalled();
        expect(result).toEqual({ recoveredRuns: 0 });
    });
});
