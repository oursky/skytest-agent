import { prisma } from '@/lib/core/prisma';

const PROJECT_ADMIN_ROLES = new Set(['ADMIN']);
const ORG_ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

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
    const membership = await prisma.projectMembership.findUnique({
        where: {
            projectId_userId: {
                projectId,
                userId,
            }
        },
        select: {
            role: true,
            project: {
                select: {
                    organizationId: true,
                }
            }
        }
    });

    if (!membership) {
        return false;
    }

    if (PROJECT_ADMIN_ROLES.has(membership.role)) {
        return true;
    }

    const orgMembership = await prisma.organizationMembership.findUnique({
        where: {
            organizationId_userId: {
                organizationId: membership.project.organizationId,
                userId,
            }
        },
        select: { role: true }
    });

    return orgMembership !== null && ORG_ADMIN_ROLES.has(orgMembership.role);
}
