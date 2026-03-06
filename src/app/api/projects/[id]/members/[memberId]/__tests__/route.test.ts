import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    verifyAuthMock,
    resolveUserIdMock,
    canManageProjectMembersMock,
    projectMembershipFindUniqueMock,
    projectMembershipCountMock,
    projectMembershipUpdateMock,
    projectMembershipDeleteMock,
} = vi.hoisted(() => ({
    verifyAuthMock: vi.fn(),
    resolveUserIdMock: vi.fn(),
    canManageProjectMembersMock: vi.fn(),
    projectMembershipFindUniqueMock: vi.fn(),
    projectMembershipCountMock: vi.fn(),
    projectMembershipUpdateMock: vi.fn(),
    projectMembershipDeleteMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: verifyAuthMock,
    resolveUserId: resolveUserIdMock,
}));

vi.mock('@/lib/security/permissions', () => ({
    canManageProjectMembers: canManageProjectMembersMock,
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
        projectMembership: {
            findUnique: projectMembershipFindUniqueMock,
            count: projectMembershipCountMock,
            update: projectMembershipUpdateMock,
            delete: projectMembershipDeleteMock,
        },
    },
}));

const { PATCH, DELETE } = await import('@/app/api/projects/[id]/members/[memberId]/route');

describe('PATCH /api/projects/[id]/members/[memberId]', () => {
    beforeEach(() => {
        verifyAuthMock.mockReset();
        resolveUserIdMock.mockReset();
        canManageProjectMembersMock.mockReset();
        projectMembershipFindUniqueMock.mockReset();
        projectMembershipCountMock.mockReset();
        projectMembershipUpdateMock.mockReset();
        projectMembershipDeleteMock.mockReset();

        verifyAuthMock.mockResolvedValue({ sub: 'auth-1', userId: 'user-1' });
        resolveUserIdMock.mockResolvedValue('user-1');
        canManageProjectMembersMock.mockResolvedValue(true);
    });

    it('prevents demoting the last project admin', async () => {
        projectMembershipFindUniqueMock.mockResolvedValue({
            id: 'membership-1',
            projectId: 'project-1',
            role: 'ADMIN',
            user: {
                id: 'user-2',
                email: 'admin@example.com',
            },
        });
        projectMembershipCountMock.mockResolvedValue(1);

        const response = await PATCH(
            new Request('http://localhost/api/projects/project-1/members/membership-1', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'MEMBER' }),
            }),
            { params: Promise.resolve({ id: 'project-1', memberId: 'membership-1' }) }
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: 'Project must have at least one admin',
        });
        expect(projectMembershipUpdateMock).not.toHaveBeenCalled();
    });

    it('updates the member role when another admin remains', async () => {
        projectMembershipFindUniqueMock.mockResolvedValue({
            id: 'membership-1',
            projectId: 'project-1',
            role: 'MEMBER',
            user: {
                id: 'user-2',
                email: 'member@example.com',
            },
        });
        projectMembershipUpdateMock.mockResolvedValue({
            id: 'membership-1',
            role: 'ADMIN',
            createdAt: new Date('2026-03-06T10:00:00.000Z'),
            updatedAt: new Date('2026-03-06T10:05:00.000Z'),
            user: {
                id: 'user-2',
                email: 'member@example.com',
            },
        });

        const response = await PATCH(
            new Request('http://localhost/api/projects/project-1/members/membership-1', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'ADMIN' }),
            }),
            { params: Promise.resolve({ id: 'project-1', memberId: 'membership-1' }) }
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            id: 'membership-1',
            userId: 'user-2',
            email: 'member@example.com',
            role: 'ADMIN',
        });
        expect(projectMembershipUpdateMock).toHaveBeenCalledWith({
            where: { id: 'membership-1' },
            data: { role: 'ADMIN' },
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

describe('DELETE /api/projects/[id]/members/[memberId]', () => {
    beforeEach(() => {
        verifyAuthMock.mockReset();
        resolveUserIdMock.mockReset();
        canManageProjectMembersMock.mockReset();
        projectMembershipFindUniqueMock.mockReset();
        projectMembershipCountMock.mockReset();
        projectMembershipUpdateMock.mockReset();
        projectMembershipDeleteMock.mockReset();

        verifyAuthMock.mockResolvedValue({ sub: 'auth-1', userId: 'user-1' });
        resolveUserIdMock.mockResolvedValue('user-1');
        canManageProjectMembersMock.mockResolvedValue(true);
    });

    it('prevents removing the last project admin', async () => {
        projectMembershipFindUniqueMock.mockResolvedValue({
            id: 'membership-1',
            projectId: 'project-1',
            role: 'ADMIN',
        });
        projectMembershipCountMock.mockResolvedValue(1);

        const response = await DELETE(
            new Request('http://localhost/api/projects/project-1/members/membership-1', {
                method: 'DELETE',
            }),
            { params: Promise.resolve({ id: 'project-1', memberId: 'membership-1' }) }
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: 'Project must have at least one admin',
        });
        expect(projectMembershipDeleteMock).not.toHaveBeenCalled();
    });

    it('removes the membership when the project still has another admin', async () => {
        projectMembershipFindUniqueMock.mockResolvedValue({
            id: 'membership-1',
            projectId: 'project-1',
            role: 'MEMBER',
        });
        projectMembershipDeleteMock.mockResolvedValue({ id: 'membership-1' });

        const response = await DELETE(
            new Request('http://localhost/api/projects/project-1/members/membership-1', {
                method: 'DELETE',
            }),
            { params: Promise.resolve({ id: 'project-1', memberId: 'membership-1' }) }
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ success: true });
        expect(projectMembershipDeleteMock).toHaveBeenCalledWith({
            where: { id: 'membership-1' }
        });
    });
});
