import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    updateMany,
    findMany,
    deleteRun,
    deleteObjectIfExists,
} = vi.hoisted(() => ({
    updateMany: vi.fn(),
    findMany: vi.fn(),
    deleteRun: vi.fn(),
    deleteObjectIfExists: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            updateMany,
            findMany,
            delete: deleteRun,
        },
    },
}));

vi.mock('@/lib/storage/object-store-utils', () => ({
    deleteObjectIfExists,
}));

const { enforceRunArtifactRetention } = await import('@/lib/runners/run-retention-service');

describe('enforceRunArtifactRetention', () => {
    beforeEach(() => {
        updateMany.mockReset();
        findMany.mockReset();
        deleteRun.mockReset();
        deleteObjectIfExists.mockReset();
    });

    it('soft deletes old completed runs and hard deletes expired soft-deleted runs', async () => {
        const now = new Date('2026-03-08T00:00:00.000Z');
        updateMany.mockResolvedValueOnce({ count: 2 });
        findMany.mockResolvedValueOnce([
            {
                id: 'run-1',
                files: [{ storedName: 'test-runs/run-1/artifacts/a.png' }],
                events: [{ artifactKey: 'test-runs/run-1/artifacts/a.png' }, { artifactKey: 'test-runs/run-1/artifacts/b.png' }],
            },
        ]);
        deleteObjectIfExists.mockResolvedValue(undefined);
        deleteRun.mockResolvedValue({});

        const result = await enforceRunArtifactRetention(now);

        expect(updateMany).toHaveBeenCalledWith({
            where: {
                deletedAt: null,
                status: { in: ['PASS', 'FAIL', 'CANCELLED'] },
                completedAt: {
                    not: null,
                    lt: new Date('2026-02-06T00:00:00.000Z'),
                },
            },
            data: {
                deletedAt: now,
            },
        });
        expect(findMany).toHaveBeenCalledWith({
            where: {
                deletedAt: { lt: new Date('2026-03-01T00:00:00.000Z') },
                status: { in: ['PASS', 'FAIL', 'CANCELLED'] },
            },
            orderBy: {
                deletedAt: 'asc',
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
        expect(deleteObjectIfExists).toHaveBeenCalledTimes(2);
        expect(deleteRun).toHaveBeenCalledWith({ where: { id: 'run-1' } });
        expect(result).toMatchObject({
            softDeletedRuns: 2,
            hardDeletedRuns: 1,
            hardDeletedArtifacts: 2,
            hardDeleteFailures: 0,
        });
    });

    it('keeps a run for retry when artifact deletion fails', async () => {
        updateMany.mockResolvedValueOnce({ count: 0 });
        findMany.mockResolvedValueOnce([
            {
                id: 'run-2',
                files: [{ storedName: 'test-runs/run-2/artifacts/a.png' }],
                events: [],
            },
        ]);
        deleteObjectIfExists.mockRejectedValueOnce(new Error('network'));

        const result = await enforceRunArtifactRetention(new Date('2026-03-08T00:00:00.000Z'));

        expect(deleteRun).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            softDeletedRuns: 0,
            hardDeletedRuns: 0,
            hardDeletedArtifacts: 0,
            hardDeleteFailures: 1,
        });
    });
});
