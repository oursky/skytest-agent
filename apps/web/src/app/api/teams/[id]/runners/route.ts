import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { getTeamRunnersOverview } from '@/lib/runners/availability-service';
import { getTeamAccess } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';

const logger = createLogger('api:teams:runners');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
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
        const { teamId } = guard;

        const overview = await getTeamRunnersOverview(teamId);

        return NextResponse.json({
            ...overview,
            canManageRunners: true,
        });
    } catch (error) {
        logger.error('Failed to load team runners', error);
        return NextResponse.json({ error: 'Failed to load team runners' }, { status: 500 });
    }
}
