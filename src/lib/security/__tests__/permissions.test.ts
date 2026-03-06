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
    canDeleteTeam,
} = await import('@/lib/security/permissions');

describe('team permissions', () => {
    beforeEach(() => {
        projectFindUnique.mockReset();
        teamMembershipFindUnique.mockReset();
    });

    it('allows team admins to manage their project', async () => {
        projectFindUnique.mockResolvedValueOnce({ teamId: 'org-1' });
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'ADMIN' });

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

    it('allows team admins to create projects', async () => {
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'ADMIN' });

        await expect(canCreateProject('user-1', 'org-1')).resolves.toBe(true);
    });

    it('allows owners to delete their team', async () => {
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'OWNER' });

        await expect(canDeleteTeam('user-1', 'org-1')).resolves.toBe(true);
    });

    it('rejects members from managing projects', async () => {
        projectFindUnique.mockResolvedValueOnce({ teamId: 'org-1' });
        teamMembershipFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });

        await expect(canManageProject('user-1', 'project-1')).resolves.toBe(false);
    });
});
