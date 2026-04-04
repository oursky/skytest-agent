import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { invalidateTeamAvailabilityCache } from '@/lib/runners/availability-service';
import { getTeamAccess } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';

const logger = createLogger('api:teams:runners:runner');

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; runnerId: string }> }
) {
    const guard = await guardTeamRouteRequest({
        request,
        params,
        authorize: async ({ userId, teamId }) => {
            const access = await getTeamAccess(userId, teamId);
            return access.isMember;
        },
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { teamId, params: { runnerId } } = guard;

        const deleted = await prisma.runner.deleteMany({
            where: {
                id: runnerId,
                teamId,
            },
        });

        if (deleted.count === 0) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Runner not found' });
        }

        invalidateTeamAvailabilityCache(teamId);

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to unpair runner', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to unpair runner' });
    }
}
