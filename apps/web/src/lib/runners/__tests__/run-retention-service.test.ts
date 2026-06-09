import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    findMany,
    deleteRun,
    deleteObjects,
} = vi.hoisted(() => ({
    findMany: vi.fn(),
    deleteRun: vi.fn(),
    deleteObjects: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findMany,
            delete: deleteRun,
        },
    },
}));

vi.mock('@/lib/storage/object-store', () => ({
    objectStore: {
        deleteObjects,
    },
}));

const { enforceRunArtifactRetention } = await import('@/lib/runners/run-retention-service');

describe('enforceRunArtifactRetention', () => {
    beforeEach(() => {
        findMany.mockReset();
        deleteRun.mockReset();
        deleteObjects.mockReset();
    });

    it('purges runs past the retention cutoff or already soft-deleted, removing their artifacts', async () => {
        const now = new Date('2026-03-08T00:00:00.000Z');
        findMany.mockResolvedValueOnce([
            {
                id: 'run-1',
                files: [{ storedName: 'test-runs/run-1/artifacts/a.png' }],
                events: [{ artifactKey: 'test-runs/run-1/artifacts/a.png' }, { artifactKey: 'test-runs/run-1/artifacts/b.png' }],
            },
        ]);
        deleteObjects.mockResolvedValue({ failedKeys: [] });
        deleteRun.mockResolvedValue({});

        const result = await enforceRunArtifactRetention(now);

        expect(findMany).toHaveBeenCalledWith({
            where: {
                status: { in: ['PASS', 'FAIL', 'CANCELLED'] },
                OR: [
                    {
                        completedAt: {
                            not: null,
                            lt: new Date('2025-12-08T00:00:00.000Z'),
                        },
                    },
                    {
                        deletedAt: { not: null },
                    },
                ],
            },
            orderBy: {
                completedAt: 'asc',
            },
            take: 50,
            select: {
                id: true,
                files: {
                    select: {
                        storedName: true,
                    },
                },
                events: {
                    where: {
                        artifactKey: { not: null },
                    },
                    select: {
                        artifactKey: true,
                    },
                },
            },
        });
        expect(deleteObjects).toHaveBeenCalledTimes(1);
        expect(deleteObjects).toHaveBeenCalledWith([
            'test-runs/run-1/artifacts/a.png',
            'test-runs/run-1/artifacts/b.png',
        ]);
        expect(deleteRun).toHaveBeenCalledWith({ where: { id: 'run-1' } });
        expect(result).toMatchObject({
            purgedRuns: 1,
            purgedArtifacts: 2,
            purgeFailures: 0,
        });
    });

    it('keeps a run for retry when artifact deletion fails', async () => {
        findMany.mockResolvedValueOnce([
            {
                id: 'run-2',
                files: [{ storedName: 'test-runs/run-2/artifacts/a.png' }],
                events: [],
            },
        ]);
        deleteObjects.mockRejectedValueOnce(new Error('network'));

        const result = await enforceRunArtifactRetention(new Date('2026-03-08T00:00:00.000Z'));

        expect(deleteRun).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            purgedRuns: 0,
            purgedArtifacts: 0,
            purgeFailures: 1,
        });
    });
});
