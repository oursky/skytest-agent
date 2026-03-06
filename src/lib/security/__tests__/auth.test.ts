import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique } = vi.hoisted(() => ({
    findUnique: vi.fn(),
}));

const { create } = vi.hoisted(() => ({
    create: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        user: {
            create,
            findUnique,
        },
    },
}));

const { resolveUserId, resolveOrCreateUserId } = await import('@/lib/security/auth');

type ResolveUserIdPayload = Parameters<typeof resolveUserId>[0];

describe('resolveUserId', () => {
    beforeEach(() => {
        create.mockReset();
        findUnique.mockReset();
    });

    it('returns the payload userId when it matches the stored auth subject', async () => {
        findUnique.mockResolvedValueOnce({ id: 'user-1', authId: 'auth-1' });

        const payload: ResolveUserIdPayload = {
            sub: 'auth-1',
            userId: 'user-1',
        } as ResolveUserIdPayload;

        await expect(resolveUserId(payload)).resolves.toBe('user-1');
        expect(findUnique).toHaveBeenCalledTimes(1);
        expect(findUnique).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            select: { id: true, authId: true },
        });
    });

    it('falls back to the subject lookup when the payload userId does not match', async () => {
        findUnique
            .mockResolvedValueOnce({ id: 'user-2', authId: 'auth-2' })
            .mockResolvedValueOnce({ id: 'user-1' });

        const payload: ResolveUserIdPayload = {
            sub: 'auth-1',
            userId: 'user-2',
        } as ResolveUserIdPayload;

        await expect(resolveUserId(payload)).resolves.toBe('user-1');
        expect(findUnique).toHaveBeenCalledTimes(2);
        expect(findUnique).toHaveBeenNthCalledWith(1, {
            where: { id: 'user-2' },
            select: { id: true, authId: true },
        });
        expect(findUnique).toHaveBeenNthCalledWith(2, {
            where: { authId: 'auth-1' },
            select: { id: true },
        });
    });
});

describe('resolveOrCreateUserId', () => {
    beforeEach(() => {
        create.mockReset();
        findUnique.mockReset();
    });

    it('creates the user when no existing record matches the auth subject', async () => {
        findUnique.mockResolvedValueOnce(null);
        create.mockResolvedValueOnce({ id: 'user-1' });

        await expect(resolveOrCreateUserId({ sub: 'auth-1' } as ResolveUserIdPayload)).resolves.toBe('user-1');
        expect(create).toHaveBeenCalledWith({
            data: { authId: 'auth-1' },
            select: { id: true },
        });
    });

    it('falls back to a lookup when concurrent creation hits the authId unique constraint', async () => {
        findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'user-1' });
        create.mockRejectedValueOnce({ code: 'P2002' });

        await expect(resolveOrCreateUserId({ sub: 'auth-1' } as ResolveUserIdPayload)).resolves.toBe('user-1');
        expect(findUnique).toHaveBeenNthCalledWith(2, {
            where: { authId: 'auth-1' },
            select: { id: true },
        });
    });
});
