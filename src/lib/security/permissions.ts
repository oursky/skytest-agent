import { prisma } from '@/lib/core/prisma';
import type { OrganizationRole, ProjectRole } from '@/types';

const PROJECT_ADMIN_ROLES = new Set(['ADMIN']);
const ORG_ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

async function getProjectOrganizationId(projectId: string): Promise<string | null> {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { organizationId: true }
    });

    return project?.organizationId ?? null;
}

async function getTestCaseProjectId(testCaseId: string): Promise<string | null> {
    const testCase = await prisma.testCase.findUnique({
        where: { id: testCaseId },
        select: { projectId: true }
    });

    return testCase?.projectId ?? null;
}

async function getTestRunProjectId(testRunId: string): Promise<string | null> {
    const testRun = await prisma.testRun.findUnique({
        where: { id: testRunId },
        select: {
            testCase: {
                select: {
                    projectId: true,
                }
            }
        }
    });

    return testRun?.testCase.projectId ?? null;
}

async function getProjectRole(userId: string, projectId: string): Promise<ProjectRole | null> {
    const membership = await prisma.projectMembership.findUnique({
        where: {
            projectId_userId: {
                projectId,
                userId,
            }
        },
        select: { role: true }
    });

    return membership?.role ?? null;
}

async function getOrganizationRole(userId: string, organizationId: string): Promise<OrganizationRole | null> {
    const membership = await prisma.organizationMembership.findUnique({
        where: {
            organizationId_userId: {
                organizationId,
                userId,
            }
        },
        select: { role: true }
    });

    return membership?.role ?? null;
}

export async function isOrganizationMember(userId: string, organizationId: string): Promise<boolean> {
    const membership = await prisma.organizationMembership.findUnique({
        where: {
            organizationId_userId: {
                organizationId,
                userId,
            }
        },
        select: { id: true }
    });

    return membership !== null;
}

export async function isProjectMember(userId: string, projectId: string): Promise<boolean> {
    const membership = await prisma.projectMembership.findUnique({
        where: {
            projectId_userId: {
                projectId,
                userId,
            }
        },
        select: { id: true }
    });

    return membership !== null;
}

export async function canManageProject(userId: string, projectId: string): Promise<boolean> {
    const projectRole = await getProjectRole(userId, projectId);
    if (projectRole === null) {
        return false;
    }

    if (PROJECT_ADMIN_ROLES.has(projectRole)) {
        return true;
    }

    const organizationId = await getProjectOrganizationId(projectId);
    if (!organizationId) {
        return false;
    }

    const organizationRole = await getOrganizationRole(userId, organizationId);
    return organizationRole !== null && ORG_ADMIN_ROLES.has(organizationRole);
}

export async function isTestCaseProjectMember(userId: string, testCaseId: string): Promise<boolean> {
    const projectId = await getTestCaseProjectId(testCaseId);
    if (!projectId) {
        return false;
    }

    return isProjectMember(userId, projectId);
}

export async function isTestRunProjectMember(userId: string, testRunId: string): Promise<boolean> {
    const projectId = await getTestRunProjectId(testRunId);
    if (!projectId) {
        return false;
    }

    return isProjectMember(userId, projectId);
}

export async function canViewProjectMembers(userId: string, projectId: string): Promise<boolean> {
    const projectRole = await getProjectRole(userId, projectId);
    if (projectRole !== null) {
        return true;
    }

    const organizationId = await getProjectOrganizationId(projectId);
    if (!organizationId) {
        return false;
    }

    const organizationRole = await getOrganizationRole(userId, organizationId);
    return organizationRole !== null && ORG_ADMIN_ROLES.has(organizationRole);
}

export async function canManageProjectMembers(userId: string, projectId: string): Promise<boolean> {
    const projectRole = await getProjectRole(userId, projectId);
    if (projectRole !== null && PROJECT_ADMIN_ROLES.has(projectRole)) {
        return true;
    }

    const organizationId = await getProjectOrganizationId(projectId);
    if (!organizationId) {
        return false;
    }

    const organizationRole = await getOrganizationRole(userId, organizationId);
    return organizationRole !== null && ORG_ADMIN_ROLES.has(organizationRole);
}

export async function getProjectOrganizationMembership(
    userId: string,
    projectId: string
): Promise<{ organizationId: string; organizationRole: OrganizationRole | null } | null> {
    const organizationId = await getProjectOrganizationId(projectId);
    if (!organizationId) {
        return null;
    }

    return {
        organizationId,
        organizationRole: await getOrganizationRole(userId, organizationId),
    };
}
