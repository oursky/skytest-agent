import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteMany } = vi.hoisted(() => ({
    deleteMany: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRunEvent: {
            deleteMany,
        },
    },
}));

const { pruneOldRunEvents } = await import('@/lib/runners/event-retention-service');

describe('pruneOldRunEvents', () => {
    beforeEach(() => {
        deleteMany.mockReset();
    });

    it('deletes events older than retention cutoff', async () => {
        deleteMany.mockResolvedValueOnce({ count: 17 });
        const now = new Date('2026-03-07T00:00:00.000Z');

        const result = await pruneOldRunEvents(now);

        expect(deleteMany).toHaveBeenCalledWith({
            where: {
                createdAt: { lt: new Date('2026-02-05T00:00:00.000Z') },
            },
        });
        expect(result.deletedEvents).toBe(17);
        expect(result.cutoff.toISOString()).toBe('2026-02-05T00:00:00.000Z');
    });
});
