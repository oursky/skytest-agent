import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { createLogger } from '@/lib/core/logger';
import { getTeamDevicesAvailability } from '@/lib/runners/availability-service';
import { isTeamMember } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';

const logger = createLogger('api:teams:devices');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTeamRouteRequest({
        request,
        params,
        authorize: ({ userId, teamId }) => isTeamMember(userId, teamId),
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { teamId } = guard;

        const availability = await getTeamDevicesAvailability(teamId);
        return NextResponse.json(availability);
    } catch (error) {
        logger.error('Failed to load team devices', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to load team devices' });
    }
}
