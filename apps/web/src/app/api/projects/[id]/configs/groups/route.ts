import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { GROUPABLE_CONFIG_TYPES, normalizeConfigGroup } from '@/lib/test-config/sort';
import { createLogger } from '@/lib/core/logger';
import { getProjectRouteAccess } from '@/lib/security/project-route-access';
import { apiError, guardAuthenticatedUser } from '@/lib/security/api-route-standards';

const logger = createLogger('api:projects:config-groups');

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await guardAuthenticatedUser(request);
    if (!auth.ok) {
        return auth.response;
    }

    try {
        const { id } = await params;
        const body = await request.json().catch(() => ({} as { group?: string | null }));
        const normalizedGroup = normalizeConfigGroup(body.group);

        if (!normalizedGroup) {
            return NextResponse.json({ error: 'Group is required' }, { status: 400 });
        }

        const access = await getProjectRouteAccess({
            projectId: id,
            userId: auth.context.userId,
        });
        if (access.kind === 'project_not_found') {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Project not found' });
        }
        if (access.kind === 'forbidden') {
            return apiError({ status: 403, code: 'FORBIDDEN', error: 'Forbidden' });
        }

        const groupableConfigs = await prisma.projectConfig.findMany({
            where: {
                projectId: id,
                type: { in: GROUPABLE_CONFIG_TYPES },
                group: { not: null },
            },
            select: {
                id: true,
                group: true,
            }
        });

        const matchingConfigIds = groupableConfigs
            .filter((config) => normalizeConfigGroup(config.group) === normalizedGroup)
            .map((config) => config.id);

        const result = matchingConfigIds.length > 0
            ? await prisma.projectConfig.updateMany({
                where: {
                    id: { in: matchingConfigIds },
                },
                data: {
                    group: null,
                }
            })
            : { count: 0 };

        return NextResponse.json({ success: true, updated: result.count });
    } catch (error) {
        logger.error('Failed to remove project config group', error);
        return NextResponse.json({ error: 'Failed to remove group' }, { status: 500 });
    }
}
