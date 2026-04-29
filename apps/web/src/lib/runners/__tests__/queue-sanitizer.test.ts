import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    testRunFindMany,
    testRunUpdateMany,
    emitRunTerminal,
} = vi.hoisted(() => ({
    testRunFindMany: vi.fn(),
    testRunUpdateMany: vi.fn(),
    emitRunTerminal: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findMany: testRunFindMany,
            updateMany: testRunUpdateMany,
        },
    },
}));

vi.mock('@/lib/runners/domain-events', () => ({
    emitRunTerminal,
}));

const { failInvalidQueuedAndroidRuns } = await import('@/lib/runners/queue-sanitizer');

describe('failInvalidQueuedAndroidRuns', () => {
    beforeEach(() => {
        testRunFindMany.mockReset();
        testRunUpdateMany.mockReset();
        emitRunTerminal.mockReset();
    });

    it('fails queued Android runs that are missing requestedDeviceId', async () => {
        const now = new Date('2026-03-13T12:00:00.000Z');
        testRunFindMany
            .mockResolvedValueOnce([
                { id: 'run-1', testCaseId: 'tc-1' },
                { id: 'run-2', testCaseId: 'tc-2' },
                { id: 'run-3', testCaseId: 'tc-3' },
            ]);
        testRunUpdateMany.mockResolvedValue({ count: 3 });

        const result = await failInvalidQueuedAndroidRuns(now);

        expect(testRunFindMany).toHaveBeenNthCalledWith(1, {
            where: {
                status: 'QUEUED',
                deletedAt: null,
                assignedRunnerId: null,
                requiredCapability: 'ANDROID',
                requestedDeviceId: null,
            },
            select: {
                id: true,
                testCaseId: true,
            },
        });
        expect(testRunUpdateMany).toHaveBeenCalledWith({
            where: {
                id: {
                    in: ['run-1', 'run-2', 'run-3'],
                },
                status: 'QUEUED',
            },
            data: {
                status: 'FAIL',
                error: 'Android run is missing requestedDeviceId; please dispatch the run again.',
                completedAt: now,
            },
        });
        expect(emitRunTerminal).toHaveBeenNthCalledWith(1, {
            runId: 'run-1',
            status: 'FAIL',
            testCaseId: 'tc-1',
        });
        expect(emitRunTerminal).toHaveBeenNthCalledWith(2, {
            runId: 'run-2',
            status: 'FAIL',
            testCaseId: 'tc-2',
        });
        expect(emitRunTerminal).toHaveBeenNthCalledWith(3, {
            runId: 'run-3',
            status: 'FAIL',
            testCaseId: 'tc-3',
        });
        expect(result).toEqual({ failedRuns: 3 });
    });

    it('returns zero when no invalid queued Android runs exist', async () => {
        testRunFindMany.mockResolvedValueOnce([]);
        testRunUpdateMany.mockResolvedValue({ count: 0 });

        const result = await failInvalidQueuedAndroidRuns();

        expect(testRunUpdateMany).not.toHaveBeenCalled();
        expect(emitRunTerminal).not.toHaveBeenCalled();
        expect(result).toEqual({ failedRuns: 0 });
    });
});
