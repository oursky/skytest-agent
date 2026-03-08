import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany, deleteMany } = vi.hoisted(() => ({
    findMany: vi.fn(),
    deleteMany: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRunEvent: {
            findMany,
            deleteMany,
        },
    },
}));

const { pruneOldRunEvents } = await import('@/lib/runners/event-retention-service');

describe('pruneOldRunEvents', () => {
    beforeEach(() => {
        findMany.mockReset();
        deleteMany.mockReset();
    });

    it('deletes events older than retention cutoff', async () => {
        findMany.mockResolvedValueOnce([{ id: 'evt-1' }, { id: 'evt-2' }]);
        findMany.mockResolvedValueOnce([]);
        deleteMany.mockResolvedValueOnce({ count: 17 });
        const now = new Date('2026-03-07T00:00:00.000Z');

        const result = await pruneOldRunEvents(now);

        expect(findMany).toHaveBeenNthCalledWith(1, {
            where: {
                createdAt: { lt: new Date('2026-02-05T00:00:00.000Z') },
            },
            orderBy: {
                createdAt: 'asc',
            },
            take: 10000,
            select: {
                id: true,
            },
        });
        expect(deleteMany).toHaveBeenCalledWith({
            where: {
                id: {
                    in: ['evt-1', 'evt-2'],
                },
            },
        });
        expect(result.deletedEvents).toBe(17);
        expect(result.cutoff.toISOString()).toBe('2026-02-05T00:00:00.000Z');
    });
});
