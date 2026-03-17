import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveUserId: vi.fn(),
    isTeamMember: vi.fn(),
    isTeamOwner: vi.fn(),
    getTeamRole: vi.fn(),
    canDeleteTeam: vi.fn(),
    canTransferTeamOwnership: vi.fn(),
    teamFindUnique: vi.fn(),
    teamUpdate: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: mocks.verifyAuth,
    resolveUserId: mocks.resolveUserId,
}));

vi.mock('@/lib/security/permissions', () => ({
    isTeamMember: mocks.isTeamMember,
    isTeamOwner: mocks.isTeamOwner,
    getTeamRole: mocks.getTeamRole,
    canDeleteTeam: mocks.canDeleteTeam,
    canTransferTeamOwnership: mocks.canTransferTeamOwnership,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        team: {
            findUnique: mocks.teamFindUnique,
            update: mocks.teamUpdate,
        },
        testRun: {
            findFirst: vi.fn(),
        },
        project: {
            findMany: vi.fn(),
        },
    },
}));

vi.mock('@/lib/storage/object-store-utils', () => ({
    deleteObjectIfExists: vi.fn(),
}));

const { GET, PATCH } = await import('@/app/api/teams/[id]/route');

describe('team route ownership controls', () => {
    beforeEach(() => {
        mocks.verifyAuth.mockReset();
        mocks.resolveUserId.mockReset();
        mocks.isTeamMember.mockReset();
        mocks.isTeamOwner.mockReset();
        mocks.getTeamRole.mockReset();
        mocks.canDeleteTeam.mockReset();
        mocks.canTransferTeamOwnership.mockReset();
        mocks.teamFindUnique.mockReset();
        mocks.teamUpdate.mockReset();

        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveUserId.mockResolvedValue('user-1');
    });

    it('returns canRename=false for non-owner member', async () => {
        mocks.isTeamMember.mockResolvedValue(true);
        mocks.getTeamRole.mockResolvedValue('MEMBER');
        mocks.canDeleteTeam.mockResolvedValue(false);
        mocks.canTransferTeamOwnership.mockResolvedValue(false);
        mocks.teamFindUnique.mockResolvedValue({
            id: 'team-1',
            name: 'Team A',
            openRouterKeyUpdatedAt: null,
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
            updatedAt: new Date('2026-03-01T00:00:00.000Z'),
            _count: { memberships: 1, projects: 1 },
        });

        const response = await GET(new Request('http://localhost/api/teams/team-1'), {
            params: Promise.resolve({ id: 'team-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.canRename).toBe(false);
    });

    it('rejects rename for non-owner member', async () => {
        mocks.isTeamOwner.mockResolvedValue(false);

        const response = await PATCH(new Request('http://localhost/api/teams/team-1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Renamed Team' }),
        }), {
            params: Promise.resolve({ id: 'team-1' }),
        });

        expect(response.status).toBe(403);
        expect(mocks.teamUpdate).not.toHaveBeenCalled();
    });
});
