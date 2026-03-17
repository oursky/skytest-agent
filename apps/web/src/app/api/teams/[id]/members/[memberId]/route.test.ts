import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveUserId: vi.fn(),
    isTeamOwner: vi.fn(),
    teamMembershipFindUnique: vi.fn(),
    teamMembershipDelete: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: mocks.verifyAuth,
    resolveUserId: mocks.resolveUserId,
}));

vi.mock('@/lib/security/permissions', () => ({
    isTeamOwner: mocks.isTeamOwner,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        teamMembership: {
            findUnique: mocks.teamMembershipFindUnique,
            delete: mocks.teamMembershipDelete,
        },
    },
}));

const { DELETE } = await import('@/app/api/teams/[id]/members/[memberId]/route');

describe('DELETE /api/teams/[id]/members/[memberId]', () => {
    beforeEach(() => {
        mocks.verifyAuth.mockReset();
        mocks.resolveUserId.mockReset();
        mocks.isTeamOwner.mockReset();
        mocks.teamMembershipFindUnique.mockReset();
        mocks.teamMembershipDelete.mockReset();

        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveUserId.mockResolvedValue('user-1');
    });

    it('rejects non-owner callers', async () => {
        mocks.isTeamOwner.mockResolvedValue(false);

        const response = await DELETE(new Request('http://localhost/api/teams/team-1/members/member-1', {
            method: 'DELETE',
        }), {
            params: Promise.resolve({ id: 'team-1', memberId: 'member-1' }),
        });

        expect(response.status).toBe(403);
        expect(mocks.teamMembershipDelete).not.toHaveBeenCalled();
    });
});
