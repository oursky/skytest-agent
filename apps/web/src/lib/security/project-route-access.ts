import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { isProjectMember } from '@/lib/security/permissions';
import { resolveUserId, verifyAuth } from '@/lib/security/auth';

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

export type ProjectRouteGuardResult<TParams extends { id: string }> =
    | {
        ok: true;
        params: TParams;
        userId: string;
    }
    | {
        ok: false;
        response: NextResponse<{ error: string }>;
    };

export async function guardProjectRouteRequest<TParams extends { id: string }>(input: {
    request: Request;
    params: Promise<TParams>;
}): Promise<ProjectRouteGuardResult<TParams>> {
    const authPayload = await verifyAuth(input.request);
    if (!authPayload) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        };
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        };
    }

    const params = await input.params;
    const access = await getProjectRouteAccess({
        projectId: params.id,
        userId,
    });

    if (access.kind === 'project_not_found') {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Project not found' }, { status: 404 }),
        };
    }

    if (access.kind === 'forbidden') {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
        };
    }

    return {
        ok: true,
        params,
        userId,
    };
}
