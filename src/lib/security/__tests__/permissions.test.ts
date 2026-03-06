import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    projectFindUnique,
    projectMembershipFindUnique,
    organizationMembershipFindUnique,
} = vi.hoisted(() => ({
    projectFindUnique: vi.fn(),
    projectMembershipFindUnique: vi.fn(),
    organizationMembershipFindUnique: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        project: {
            findUnique: projectFindUnique,
        },
        projectMembership: {
            findUnique: projectMembershipFindUnique,
        },
        organizationMembership: {
            findUnique: organizationMembershipFindUnique,
        },
    },
}));

const {
    canManageProject,
    canManageProjectMembers,
    canViewProjectMembers,
} = await import('@/lib/security/permissions');

describe('project membership permissions', () => {
    beforeEach(() => {
        projectFindUnique.mockReset();
        projectMembershipFindUnique.mockReset();
        organizationMembershipFindUnique.mockReset();
    });

    it('allows project admins to manage their project', async () => {
        projectMembershipFindUnique.mockResolvedValueOnce({ role: 'ADMIN' });

        await expect(canManageProject('user-1', 'project-1')).resolves.toBe(true);
        expect(projectMembershipFindUnique).toHaveBeenCalledWith({
            where: {
                projectId_userId: {
                    projectId: 'project-1',
                    userId: 'user-1',
                }
            },
            select: { role: true }
        });
    });

    it('allows org admins to manage project members without project membership', async () => {
        projectMembershipFindUnique.mockResolvedValueOnce(null);
        projectFindUnique.mockResolvedValueOnce({ organizationId: 'org-1' });
        organizationMembershipFindUnique.mockResolvedValueOnce({ role: 'ADMIN' });

        await expect(canManageProjectMembers('user-1', 'project-1')).resolves.toBe(true);
    });

    it('allows org admins to view project members without project membership', async () => {
        projectMembershipFindUnique.mockResolvedValueOnce(null);
        projectFindUnique.mockResolvedValueOnce({ organizationId: 'org-1' });
        organizationMembershipFindUnique.mockResolvedValueOnce({ role: 'OWNER' });

        await expect(canViewProjectMembers('user-1', 'project-1')).resolves.toBe(true);
    });

    it('rejects non-admin project members from managing project members', async () => {
        projectMembershipFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });
        projectFindUnique.mockResolvedValueOnce({ organizationId: 'org-1' });
        organizationMembershipFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });

        await expect(canManageProjectMembers('user-1', 'project-1')).resolves.toBe(false);
    });
});
