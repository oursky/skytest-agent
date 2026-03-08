import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    projectFindUnique,
    teamMembershipFindUnique,
} = vi.hoisted(() => ({
    projectFindUnique: vi.fn(),
    teamMembershipFindUnique: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        project: {
            findUnique: projectFindUnique,
        },
        teamMembership: {
            findUnique: teamMembershipFindUnique,
        },
    },
}));

const {
    isProjectMember,
    isTeamMember,
    canDeleteProject,
    canDeleteTeam,
    getTeamAccess,
} = await import('@/lib/security/permissions');

describe('team permissions', () => {
    beforeEach(() => {
        projectFindUnique.mockReset();
        teamMembershipFindUnique.mockReset();
    });

    it('allows team members to access their project', async () => {
        projectFindUnique.mockResolvedValueOnce({ teamId: 'org-1' });
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });

        await expect(isProjectMember('user-1', 'project-1')).resolves.toBe(true);
        expect(teamMembershipFindUnique).toHaveBeenCalledWith({
            where: {
                teamId_userId: {
                    teamId: 'org-1',
                    userId: 'user-1',
                }
            },
            select: { role: true }
        });
    });

    it('allows team members to access their team', async () => {
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });

        await expect(isTeamMember('user-1', 'org-1')).resolves.toBe(true);
    });

    it('allows owners to delete their team', async () => {
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'OWNER' });

        await expect(canDeleteTeam('user-1', 'org-1')).resolves.toBe(true);
    });

    it('prevents members from deleting their team', async () => {
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });

        await expect(canDeleteTeam('user-1', 'org-1')).resolves.toBe(false);
    });

    it('only allows owners to delete projects', async () => {
        projectFindUnique.mockResolvedValueOnce({ teamId: 'org-1' });
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'OWNER' });

        await expect(canDeleteProject('user-1', 'project-1')).resolves.toBe(true);
    });

    it('returns centralized owner capabilities', async () => {
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'OWNER' });

        await expect(getTeamAccess('user-1', 'org-1')).resolves.toEqual({
            teamId: 'org-1',
            role: 'OWNER',
            isMember: true,
            canDeleteProjects: true,
            canDeleteTeam: true,
            canTransferOwnership: true,
        });
    });

    it('returns no capabilities for non-members', async () => {
        teamMembershipFindUnique.mockResolvedValueOnce(null);

        await expect(getTeamAccess('user-1', 'org-1')).resolves.toEqual({
            teamId: 'org-1',
            role: null,
            isMember: false,
            canDeleteProjects: false,
            canDeleteTeam: false,
            canTransferOwnership: false,
        });
    });
});
