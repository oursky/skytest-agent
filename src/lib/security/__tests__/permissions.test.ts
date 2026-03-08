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
    canManageProject,
    canCreateProject,
    canDeleteProject,
    canDeleteTeam,
    canRenameTeam,
    getTeamAccess,
} = await import('@/lib/security/permissions');

describe('team permissions', () => {
    beforeEach(() => {
        projectFindUnique.mockReset();
        teamMembershipFindUnique.mockReset();
    });

    it('allows team members to manage their project', async () => {
        projectFindUnique.mockResolvedValueOnce({ teamId: 'org-1' });
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });

        await expect(canManageProject('user-1', 'project-1')).resolves.toBe(true);
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

    it('allows team members to create projects', async () => {
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });

        await expect(canCreateProject('user-1', 'org-1')).resolves.toBe(true);
    });

    it('allows owners to delete their team', async () => {
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'OWNER' });

        await expect(canDeleteTeam('user-1', 'org-1')).resolves.toBe(true);
    });

    it('allows members to delete their team', async () => {
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });

        await expect(canDeleteTeam('user-1', 'org-1')).resolves.toBe(true);
    });

    it('only allows owners to delete projects', async () => {
        projectFindUnique.mockResolvedValueOnce({ teamId: 'org-1' });
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'OWNER' });

        await expect(canDeleteProject('user-1', 'project-1')).resolves.toBe(true);
    });

    it('allows members to rename teams', async () => {
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });

        await expect(canRenameTeam('user-1', 'org-1')).resolves.toBe(true);
    });

    it('returns centralized owner capabilities', async () => {
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'OWNER' });

        await expect(getTeamAccess('user-1', 'org-1')).resolves.toEqual({
            teamId: 'org-1',
            role: 'OWNER',
            isMember: true,
            canManageProjects: true,
            canDeleteProjects: true,
            canManageMembers: true,
            canManageApiKey: true,
            canRenameTeam: true,
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
            canManageProjects: false,
            canDeleteProjects: false,
            canManageMembers: false,
            canManageApiKey: false,
            canRenameTeam: false,
            canDeleteTeam: false,
            canTransferOwnership: false,
        });
    });
});
