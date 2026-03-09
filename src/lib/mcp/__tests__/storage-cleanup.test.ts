import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteObjectIfExists } = vi.hoisted(() => ({
    deleteObjectIfExists: vi.fn(),
}));

vi.mock('@/lib/storage/object-store-utils', () => ({
    deleteObjectIfExists,
}));

const { deleteObjectKeysBestEffort } = await import('@/lib/mcp/storage-cleanup');

describe('deleteObjectKeysBestEffort', () => {
    beforeEach(() => {
        deleteObjectIfExists.mockReset();
    });

    it('returns empty result for no object keys', async () => {
        await expect(deleteObjectKeysBestEffort([])).resolves.toEqual({
            deletedObjectCount: 0,
            failedObjectKeys: [],
        });
        expect(deleteObjectIfExists).not.toHaveBeenCalled();
    });

    it('deletes every key when no storage errors occur', async () => {
        deleteObjectIfExists.mockResolvedValue(undefined);

        const result = await deleteObjectKeysBestEffort(['a', 'b', 'c']);

        expect(deleteObjectIfExists).toHaveBeenCalledTimes(3);
        expect(result).toEqual({
            deletedObjectCount: 3,
            failedObjectKeys: [],
        });
    });

    it('reports failed object keys while continuing best-effort cleanup', async () => {
        deleteObjectIfExists.mockImplementation(async (key: string) => {
            if (key === 'bad') {
                throw new Error('failed');
            }
        });

        const result = await deleteObjectKeysBestEffort(['ok-1', 'bad', 'ok-2']);

        expect(deleteObjectIfExists).toHaveBeenCalledTimes(3);
        expect(result.deletedObjectCount).toBe(2);
        expect(result.failedObjectKeys).toEqual(['bad']);
    });
});
