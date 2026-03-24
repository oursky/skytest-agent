import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveOrCreateUserId: vi.fn(),
    teamMembershipFindMany: vi.fn(),
    projectFindMany: vi.fn(),
    testCaseFindMany: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: mocks.verifyAuth,
    resolveOrCreateUserId: mocks.resolveOrCreateUserId,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        teamMembership: {
            findMany: mocks.teamMembershipFindMany,
        },
        project: {
            findMany: mocks.projectFindMany,
        },
        testCase: {
            findMany: mocks.testCaseFindMany,
        },
    },
}));

const { GET } = await import('@/app/api/projects/bootstrap/route');

describe('GET /api/projects/bootstrap', () => {
    beforeEach(() => {
        mocks.verifyAuth.mockReset();
        mocks.resolveOrCreateUserId.mockReset();
        mocks.teamMembershipFindMany.mockReset();
        mocks.projectFindMany.mockReset();
        mocks.testCaseFindMany.mockReset();

        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveOrCreateUserId.mockResolvedValue('user-1');
    });

    it('returns unauthorized when auth payload is missing', async () => {
        mocks.verifyAuth.mockResolvedValue(null);

        const response = await GET(new Request('http://localhost/api/projects/bootstrap'));
        const payload = await response.json();

        expect(response.status).toBe(401);
        expect(payload).toEqual({ error: 'Unauthorized' });
    });

    it('uses requested team when available and returns hydrated projects payload', async () => {
        const now = new Date('2026-03-24T12:00:00.000Z');
        mocks.teamMembershipFindMany.mockResolvedValue([
            {
                role: 'OWNER',
                team: { id: 'team-1', name: 'Team 1', createdAt: now, updatedAt: now },
            },
            {
                role: 'MEMBER',
                team: { id: 'team-2', name: 'Team 2', createdAt: now, updatedAt: now },
            },
        ]);
        mocks.projectFindMany.mockResolvedValue([
            {
                id: 'project-2',
                name: 'Project 2',
                maxConcurrentRuns: 1,
                teamId: 'team-2',
                createdByUserId: 'user-1',
                createdAt: now,
                updatedAt: now,
                _count: { testCases: 3 },
                team: {
                    memberships: [{ role: 'MEMBER' }],
                },
            },
        ]);
        mocks.testCaseFindMany.mockResolvedValue([{ projectId: 'project-2' }]);

        const response = await GET(new Request('http://localhost/api/projects/bootstrap?teamId=team-2', {
            headers: {
                cookie: 'skytest_current_team=team-1',
            },
        }));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.currentTeam).toMatchObject({ id: 'team-2', name: 'Team 2' });
        expect(payload.projects).toHaveLength(1);
        expect(payload.projects[0]).toMatchObject({
            id: 'project-2',
            hasActiveRuns: true,
            currentUserRole: 'MEMBER',
        });
        expect(response.headers.get('set-cookie')).toContain('skytest_current_team=team-2');
    });

    it('returns empty projects payload when user has no teams', async () => {
        mocks.teamMembershipFindMany.mockResolvedValue([]);

        const response = await GET(new Request('http://localhost/api/projects/bootstrap'));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toEqual({
            teams: [],
            currentTeam: null,
            projects: [],
        });
        expect(mocks.projectFindMany).not.toHaveBeenCalled();
        expect(mocks.testCaseFindMany).not.toHaveBeenCalled();
    });
});
