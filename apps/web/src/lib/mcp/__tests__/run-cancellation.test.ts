import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testRunFindUnique, testRunUpdateMany, testCaseUpdate, androidResourceLockDeleteMany, transaction } = vi.hoisted(() => ({
    testRunFindUnique: vi.fn(),
    testRunUpdateMany: vi.fn(),
    testCaseUpdate: vi.fn(),
    androidResourceLockDeleteMany: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findUnique: testRunFindUnique,
        },
        $transaction: transaction,
    },
}));

const { cancelRunDurably } = await import('@/lib/mcp/run-cancellation');

describe('cancelRunDurably', () => {
    beforeEach(() => {
        testRunFindUnique.mockReset();
        testRunUpdateMany.mockReset();
        testCaseUpdate.mockReset();
        androidResourceLockDeleteMany.mockReset();
        transaction.mockReset();
        transaction.mockImplementation(async (callback: (tx: {
            testRun: { updateMany: typeof testRunUpdateMany };
            testCase: { update: typeof testCaseUpdate };
            androidResourceLock: { deleteMany: typeof androidResourceLockDeleteMany };
        }) => Promise<unknown>) => callback({
            testRun: { updateMany: testRunUpdateMany },
            testCase: { update: testCaseUpdate },
            androidResourceLock: { deleteMany: androidResourceLockDeleteMany },
        }));
    });

    it('returns false when the run does not exist', async () => {
        testRunFindUnique.mockResolvedValueOnce(null);

        await expect(cancelRunDurably('run-1', 'reason')).resolves.toBe(false);
        expect(testRunUpdateMany).not.toHaveBeenCalled();
        expect(testCaseUpdate).not.toHaveBeenCalled();
    });

    it('returns false when the run is already terminal', async () => {
        testRunFindUnique.mockResolvedValueOnce({
            id: 'run-1',
            status: 'PASS',
            testCaseId: 'tc-1',
        });

        await expect(cancelRunDurably('run-1', 'reason')).resolves.toBe(false);
        expect(testRunUpdateMany).not.toHaveBeenCalled();
        expect(testCaseUpdate).not.toHaveBeenCalled();
    });

    it('returns false when the run becomes non-active before update', async () => {
        testRunFindUnique.mockResolvedValueOnce({
            id: 'run-1',
            status: 'RUNNING',
            testCaseId: 'tc-1',
        });
        testRunUpdateMany.mockResolvedValueOnce({ count: 0 });

        await expect(cancelRunDurably('run-1', 'reason')).resolves.toBe(false);
        expect(testCaseUpdate).not.toHaveBeenCalled();
    });

    it('cancels active runs and updates test case status', async () => {
        testRunFindUnique.mockResolvedValueOnce({
            id: 'run-1',
            status: 'RUNNING',
            testCaseId: 'tc-1',
        });
        testRunUpdateMany.mockResolvedValueOnce({ count: 1 });
        testCaseUpdate.mockResolvedValueOnce({ id: 'tc-1', status: 'CANCELLED' });

        await expect(cancelRunDurably('run-1', 'Cancelled by test')).resolves.toBe(true);

        expect(testRunUpdateMany).toHaveBeenCalledWith({
            where: {
                id: 'run-1',
                status: { in: ['RUNNING', 'QUEUED', 'PREPARING'] },
            },
            data: {
                status: 'CANCELLED',
                error: 'Cancelled by test',
                completedAt: expect.any(Date),
                assignedRunnerId: null,
                leaseExpiresAt: null,
            },
        });
        expect(testCaseUpdate).toHaveBeenCalledWith({
            where: { id: 'tc-1' },
            data: { status: 'CANCELLED' },
        });
        expect(androidResourceLockDeleteMany).toHaveBeenCalledWith({
            where: {
                runId: 'run-1',
            },
        });
    });
});
