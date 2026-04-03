import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { GROUPABLE_CONFIG_TYPES, normalizeConfigGroup } from '@/lib/test-config/sort';
import { createLogger } from '@/lib/core/logger';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';

const logger = createLogger('api:projects:config-groups');

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id } = guard.params;
        const body = await request.json().catch(() => ({} as { group?: string | null }));
        const normalizedGroup = normalizeConfigGroup(body.group);

        if (!normalizedGroup) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Group is required' });
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
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to remove group' });
    }
}
