import { prisma } from '@/lib/core/prisma';
import { isProjectMember } from '@/lib/security/permissions';

export type ProjectRouteAccessResult =
    | { kind: 'ok' }
    | { kind: 'project_not_found' }
    | { kind: 'forbidden' };

export async function getProjectRouteAccess(input: {
    projectId: string;
    userId: string;
}): Promise<ProjectRouteAccessResult> {
    const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { id: true },
    });

    if (!project) {
        return { kind: 'project_not_found' };
    }

    const isMember = await isProjectMember(input.userId, input.projectId);
    if (!isMember) {
        return { kind: 'forbidden' };
    }

    return { kind: 'ok' };
}
