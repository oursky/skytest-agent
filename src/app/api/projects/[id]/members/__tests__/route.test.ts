import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    verifyAuthMock,
    resolveUserIdMock,
    canManageProjectMembersMock,
    getProjectOrganizationMembershipMock,
    organizationMembershipFindUniqueMock,
    projectMembershipFindUniqueMock,
    projectMembershipCreateMock,
} = vi.hoisted(() => ({
    verifyAuthMock: vi.fn(),
    resolveUserIdMock: vi.fn(),
    canManageProjectMembersMock: vi.fn(),
    getProjectOrganizationMembershipMock: vi.fn(),
    organizationMembershipFindUniqueMock: vi.fn(),
    projectMembershipFindUniqueMock: vi.fn(),
    projectMembershipCreateMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: verifyAuthMock,
    resolveUserId: resolveUserIdMock,
}));

vi.mock('@/lib/security/permissions', () => ({
    canManageProjectMembers: canManageProjectMembersMock,
    canViewProjectMembers: vi.fn(),
    getProjectOrganizationMembership: getProjectOrganizationMembershipMock,
}));

vi.mock('@/lib/core/logger', () => ({
    createLogger: () => ({
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    }),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        organizationMembership: {
            findUnique: organizationMembershipFindUniqueMock,
        },
        projectMembership: {
            findUnique: projectMembershipFindUniqueMock,
            create: projectMembershipCreateMock,
        },
    },
}));

const { POST } = await import('@/app/api/projects/[id]/members/route');

describe('POST /api/projects/[id]/members', () => {
    beforeEach(() => {
        verifyAuthMock.mockReset();
        resolveUserIdMock.mockReset();
        canManageProjectMembersMock.mockReset();
        getProjectOrganizationMembershipMock.mockReset();
        organizationMembershipFindUniqueMock.mockReset();
        projectMembershipFindUniqueMock.mockReset();
        projectMembershipCreateMock.mockReset();

        verifyAuthMock.mockResolvedValue({ sub: 'auth-1', userId: 'user-1' });
        resolveUserIdMock.mockResolvedValue('user-1');
        canManageProjectMembersMock.mockResolvedValue(true);
        getProjectOrganizationMembershipMock.mockResolvedValue({
            organizationId: 'org-1',
            organizationRole: 'OWNER',
        });
    });

    it('rejects adding a user who is not in the organization', async () => {
        organizationMembershipFindUniqueMock.mockResolvedValue(null);

        const response = await POST(
            new Request('http://localhost/api/projects/project-1/members', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: 'user-2', role: 'MEMBER' }),
            }),
            { params: Promise.resolve({ id: 'project-1' }) }
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: 'User must belong to the organization before joining this project',
        });
        expect(projectMembershipCreateMock).not.toHaveBeenCalled();
    });

    it('creates a project membership when the target user belongs to the organization', async () => {
        organizationMembershipFindUniqueMock.mockResolvedValue({ id: 'org-membership-1' });
        projectMembershipFindUniqueMock.mockResolvedValue(null);
        projectMembershipCreateMock.mockResolvedValue({
            id: 'membership-1',
            role: 'ADMIN',
            createdAt: new Date('2026-03-06T10:00:00.000Z'),
            updatedAt: new Date('2026-03-06T10:00:00.000Z'),
            user: {
                id: 'user-2',
                email: 'member@example.com',
            },
        });

        const response = await POST(
            new Request('http://localhost/api/projects/project-1/members', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: 'user-2', role: 'ADMIN' }),
            }),
            { params: Promise.resolve({ id: 'project-1' }) }
        );

        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toMatchObject({
            id: 'membership-1',
            userId: 'user-2',
            email: 'member@example.com',
            role: 'ADMIN',
        });
        expect(projectMembershipCreateMock).toHaveBeenCalledWith({
            data: {
                projectId: 'project-1',
                userId: 'user-2',
                role: 'ADMIN',
            },
            select: {
                id: true,
                role: true,
                createdAt: true,
                updatedAt: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                    }
                }
            }
        });
    });
});
