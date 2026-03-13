import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testRunUpdateMany } = vi.hoisted(() => ({
    testRunUpdateMany: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            updateMany: testRunUpdateMany,
        },
    },
}));

const { failInvalidQueuedAndroidRuns } = await import('@/lib/runners/queue-sanitizer');

describe('failInvalidQueuedAndroidRuns', () => {
    beforeEach(() => {
        testRunUpdateMany.mockReset();
    });

    it('fails queued Android runs that are missing requestedDeviceId', async () => {
        const now = new Date('2026-03-13T12:00:00.000Z');
        testRunUpdateMany.mockResolvedValue({ count: 3 });

        const result = await failInvalidQueuedAndroidRuns(now);

        expect(testRunUpdateMany).toHaveBeenCalledWith({
            where: {
                status: 'QUEUED',
                deletedAt: null,
                assignedRunnerId: null,
                requiredCapability: 'ANDROID',
                requestedDeviceId: null,
            },
            data: {
                status: 'FAIL',
                error: 'Android run is missing requestedDeviceId; please dispatch the run again.',
                completedAt: now,
            },
        });
        expect(result).toEqual({ failedRuns: 3 });
    });

    it('returns zero when no invalid queued Android runs exist', async () => {
        testRunUpdateMany.mockResolvedValue({ count: 0 });

        const result = await failInvalidQueuedAndroidRuns();

        expect(result).toEqual({ failedRuns: 0 });
    });
});
