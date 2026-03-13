import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createRemoteJWKSet, jwtVerify } = vi.hoisted(() => ({
    createRemoteJWKSet: vi.fn(),
    jwtVerify: vi.fn(),
}));

const { findUnique, update, upsert } = vi.hoisted(() => ({
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
}));

const { deleteMembership, findFirstMembership, findManyMemberships, updateMembership, updateManyMemberships } = vi.hoisted(() => ({
    deleteMembership: vi.fn(),
    findFirstMembership: vi.fn(),
    findManyMemberships: vi.fn(),
    updateMembership: vi.fn(),
    updateManyMemberships: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        user: {
            findUnique,
            update,
            upsert,
        },
        teamMembership: {
            delete: deleteMembership,
            findFirst: findFirstMembership,
            findMany: findManyMemberships,
            update: updateMembership,
            updateMany: updateManyMemberships,
        },
    },
}));

vi.mock('jose', () => ({
    createRemoteJWKSet,
    jwtVerify,
}));

const { resolveUserId, resolveOrCreateUserId, verifyAuth } = await import('@/lib/security/auth');

type ResolveUserIdPayload = Parameters<typeof resolveUserId>[0];

describe('resolveUserId', () => {
    beforeEach(() => {
        process.env.AUTHGEAR_ENDPOINT = 'https://example.authgear.com';
        createRemoteJWKSet.mockReset();
        jwtVerify.mockReset();
        findUnique.mockReset();
        update.mockReset();
        upsert.mockReset();
        deleteMembership.mockReset();
        findFirstMembership.mockReset();
        findManyMemberships.mockReset();
        updateMembership.mockReset();
        updateManyMemberships.mockReset();
        findManyMemberships.mockResolvedValue([]);
        updateManyMemberships.mockResolvedValue({ count: 0 });
    });

    it('returns the payload userId when it matches the stored auth subject', async () => {
        findUnique.mockResolvedValueOnce({ id: 'user-1', authId: 'auth-1', email: 'user@example.com' });

        const payload: ResolveUserIdPayload = {
            sub: 'auth-1',
            userId: 'user-1',
        } as ResolveUserIdPayload;

        await expect(resolveUserId(payload)).resolves.toBe('user-1');
        expect(findUnique).toHaveBeenCalledTimes(1);
        expect(findUnique).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            select: { id: true, authId: true, email: true },
        });
    });

    it('falls back to the subject lookup when the payload userId does not match', async () => {
        findUnique
            .mockResolvedValueOnce({ id: 'user-2', authId: 'auth-2', email: 'wrong@example.com' });
        upsert.mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com' });

        const payload: ResolveUserIdPayload = {
            sub: 'auth-1',
            userId: 'user-2',
            email: 'user@example.com',
        } as ResolveUserIdPayload;

        await expect(resolveUserId(payload)).resolves.toBe('user-1');
        expect(findUnique).toHaveBeenCalledTimes(1);
        expect(findUnique).toHaveBeenNthCalledWith(1, {
            where: { id: 'user-2' },
            select: { id: true, authId: true, email: true },
        });
        expect(upsert).toHaveBeenCalledWith({
            where: { authId: 'auth-1' },
            update: { email: 'user@example.com' },
            create: { authId: 'auth-1', email: 'user@example.com' },
            select: { id: true, email: true },
        });
    });

    it('syncs the latest Authgear email and claims matching email memberships', async () => {
        findUnique.mockResolvedValueOnce({ id: 'user-1', authId: 'auth-1', email: 'old@example.com' });
        update.mockResolvedValueOnce({ id: 'user-1', email: 'new@example.com' });
        findManyMemberships.mockResolvedValueOnce([{ id: 'membership-1', teamId: 'team-1' }]);
        findFirstMembership.mockResolvedValueOnce(null);
        updateMembership.mockResolvedValueOnce({ id: 'membership-1' });

        await expect(resolveUserId({
            sub: 'auth-1',
            userId: 'user-1',
            email: 'new@example.com',
        } as ResolveUserIdPayload)).resolves.toBe('user-1');

        expect(update).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: { email: 'new@example.com' },
            select: { id: true, email: true }
        });
        expect(findManyMemberships).toHaveBeenCalledWith({
            where: {
                email: 'new@example.com',
                userId: null,
            },
            select: {
                id: true,
                teamId: true,
            }
        });
        expect(updateMembership).toHaveBeenCalledWith({
            where: { id: 'membership-1' },
            data: {
                userId: 'user-1',
                email: 'new@example.com',
            }
        });
        expect(updateManyMemberships).toHaveBeenCalledWith({
            where: { userId: 'user-1' },
            data: { email: 'new@example.com' }
        });
    });

    it('uses preferred_username when it contains an email address', async () => {
        upsert.mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com' });

        await expect(resolveUserId({
            sub: 'auth-1',
            preferred_username: 'User@Example.com',
        } as ResolveUserIdPayload)).resolves.toBe('user-1');

        expect(upsert).toHaveBeenCalledWith({
            where: { authId: 'auth-1' },
            update: { email: 'user@example.com' },
            create: { authId: 'auth-1', email: 'user@example.com' },
            select: { id: true, email: true },
        });
    });
});

describe('resolveOrCreateUserId', () => {
    beforeEach(() => {
        process.env.AUTHGEAR_ENDPOINT = 'https://example.authgear.com';
        createRemoteJWKSet.mockReset();
        jwtVerify.mockReset();
        findUnique.mockReset();
        update.mockReset();
        upsert.mockReset();
        deleteMembership.mockReset();
        findFirstMembership.mockReset();
        findManyMemberships.mockReset();
        updateMembership.mockReset();
        updateManyMemberships.mockReset();
        findManyMemberships.mockResolvedValue([]);
        updateManyMemberships.mockResolvedValue({ count: 0 });
    });

    it('upserts the user when no existing record matches the auth subject', async () => {
        upsert.mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com' });

        await expect(resolveOrCreateUserId({
            sub: 'auth-1',
            email: 'user@example.com',
        } as ResolveUserIdPayload)).resolves.toBe('user-1');
        expect(upsert).toHaveBeenCalledWith({
            where: { authId: 'auth-1' },
            update: { email: 'user@example.com' },
            create: { authId: 'auth-1', email: 'user@example.com' },
            select: { id: true, email: true },
        });
    });

    it('returns null for API key payloads that reference a missing local user', async () => {
        findUnique.mockResolvedValueOnce(null);

        await expect(resolveOrCreateUserId({
            sub: 'user-1',
            userId: 'user-1',
        } as ResolveUserIdPayload)).resolves.toBeNull();
        expect(upsert).not.toHaveBeenCalled();
    });
});

describe('verifyAuth', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        process.env.AUTHGEAR_ENDPOINT = 'https://example.authgear.com';
        createRemoteJWKSet.mockReset();
        jwtVerify.mockReset();
        findUnique.mockReset();
        fetchMock.mockReset();
        createRemoteJWKSet.mockReturnValue({} as ReturnType<typeof createRemoteJWKSet>);
        vi.stubGlobal('fetch', fetchMock);
    });

    it('falls back to the Authgear userinfo endpoint for email', async () => {
        jwtVerify.mockResolvedValueOnce({ payload: { sub: 'auth-1' } });
        findUnique.mockResolvedValueOnce({ id: 'user-1', authId: 'auth-1', email: null });
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ email: 'user@example.com' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        const result = await verifyAuth(new Request('http://localhost/api/test', {
            headers: {
                Authorization: 'Bearer access-token',
            }
        }));

        expect(fetchMock).toHaveBeenCalledWith(
            new URL('/oauth2/userinfo', 'https://example.authgear.com'),
            expect.objectContaining({
                headers: {
                    Authorization: 'Bearer access-token',
                },
                cache: 'no-store',
            })
        );
        expect(result).toEqual({
            sub: 'auth-1',
            email: 'user@example.com',
            userId: 'user-1',
        });
    });
});
