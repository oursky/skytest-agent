import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    projectFindUnique,
    organizationMembershipFindUnique,
} = vi.hoisted(() => ({
    projectFindUnique: vi.fn(),
    organizationMembershipFindUnique: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        project: {
            findUnique: projectFindUnique,
        },
        organizationMembership: {
            findUnique: organizationMembershipFindUnique,
        },
    },
}));

const {
    canManageProject,
    canCreateProject,
    canDeleteOrganization,
} = await import('@/lib/security/permissions');

describe('team permissions', () => {
    beforeEach(() => {
        projectFindUnique.mockReset();
        organizationMembershipFindUnique.mockReset();
    });

    it('allows team admins to manage their project', async () => {
        projectFindUnique.mockResolvedValueOnce({ organizationId: 'org-1' });
        organizationMembershipFindUnique.mockResolvedValueOnce({ role: 'ADMIN' });

        await expect(canManageProject('user-1', 'project-1')).resolves.toBe(true);
        expect(organizationMembershipFindUnique).toHaveBeenCalledWith({
            where: {
                organizationId_userId: {
                    organizationId: 'org-1',
                    userId: 'user-1',
                }
            },
            select: { role: true }
        });
    });

    it('allows team admins to create projects', async () => {
        organizationMembershipFindUnique.mockResolvedValueOnce({ role: 'ADMIN' });

        await expect(canCreateProject('user-1', 'org-1')).resolves.toBe(true);
    });

    it('allows owners to delete their team', async () => {
        organizationMembershipFindUnique.mockResolvedValueOnce({ role: 'OWNER' });

        await expect(canDeleteOrganization('user-1', 'org-1')).resolves.toBe(true);
    });

    it('rejects members from managing projects', async () => {
        projectFindUnique.mockResolvedValueOnce({ organizationId: 'org-1' });
        organizationMembershipFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });

        await expect(canManageProject('user-1', 'project-1')).resolves.toBe(false);
    });
});
