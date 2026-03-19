import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveUserId: vi.fn(),
    isTeamMember: vi.fn(),
    teamMembershipFindMany: vi.fn(),
    userFindFirst: vi.fn(),
    teamMembershipFindFirst: vi.fn(),
    teamMembershipCreate: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: mocks.verifyAuth,
    resolveUserId: mocks.resolveUserId,
}));

vi.mock('@/lib/security/permissions', () => ({
    isTeamMember: mocks.isTeamMember,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        teamMembership: {
            findMany: mocks.teamMembershipFindMany,
            findFirst: mocks.teamMembershipFindFirst,
            create: mocks.teamMembershipCreate,
        },
        user: {
            findFirst: mocks.userFindFirst,
        },
    },
}));

const { GET, POST } = await import('@/app/api/teams/[id]/members/route');

describe('team members route access controls', () => {
    beforeEach(() => {
        mocks.verifyAuth.mockReset();
        mocks.resolveUserId.mockReset();
        mocks.isTeamMember.mockReset();
        mocks.teamMembershipFindMany.mockReset();
        mocks.userFindFirst.mockReset();
        mocks.teamMembershipFindFirst.mockReset();
        mocks.teamMembershipCreate.mockReset();

        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveUserId.mockResolvedValue('user-1');
    });

    it('returns canManageMembers=true for team members', async () => {
        mocks.isTeamMember.mockResolvedValue(true);
        mocks.teamMembershipFindMany.mockResolvedValue([]);

        const response = await GET(new Request('http://localhost/api/teams/team-1/members'), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.canManageMembers).toBe(true);
    });

    it('rejects member add when caller is not a team member', async () => {
        mocks.isTeamMember.mockResolvedValue(false);

        const response = await POST(new Request('http://localhost/api/teams/team-1/members', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'member@example.com' }),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });

        expect(response.status).toBe(403);
        expect(mocks.teamMembershipCreate).not.toHaveBeenCalled();
    });
});
