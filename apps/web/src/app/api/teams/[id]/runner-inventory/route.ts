import { createLogger } from '@/lib/core/logger';
import { getTeamDevicesAvailability, getTeamRunnersOverview } from '@/lib/runners/availability-service';
import { createMeasuredJsonResponse, createRoutePerfTracker } from '@/lib/core/route-perf';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';
import { isTeamMember } from '@/lib/security/permissions';

const logger = createLogger('api:teams:runner-inventory');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const perf = createRoutePerfTracker('/api/teams/[id]/runner-inventory', request);
    const guard = await perf.measureAuth(() => guardTeamRouteRequest({
        request,
        params,
        authorize: ({ userId, teamId }) => isTeamMember(userId, teamId),
    }));
    if (!guard.ok) {
        const responseBytes = new TextEncoder().encode(await guard.response.clone().text()).length;
        perf.log(logger, { statusCode: guard.response.status, responseBytes });
        return guard.response;
    }

    try {
        const { teamId } = guard;

        const [overview, availability] = await perf.measureDb(() => Promise.all([
            getTeamRunnersOverview(teamId),
            getTeamDevicesAvailability(teamId),
        ]));

        const body = {
            ...overview,
            availableDeviceCount: availability.availableDeviceCount,
            staleDeviceCount: availability.staleDeviceCount,
            devices: availability.devices,
            canManageRunners: true,
        };
        const { response, responseBytes } = createMeasuredJsonResponse(body);
        perf.log(logger, { statusCode: 200, responseBytes });
        return response;
    } catch (error) {
        logger.error('Failed to load team runner inventory', error);
        const body = { error: 'Failed to load team runner inventory' };
        const { response, responseBytes } = createMeasuredJsonResponse(body, { status: 500 });
        perf.log(logger, { statusCode: 500, responseBytes });
        return response;
    }
}
