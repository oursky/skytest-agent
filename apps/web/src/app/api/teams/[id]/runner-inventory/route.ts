import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { getTeamDevicesAvailability, getTeamRunnersOverview } from '@/lib/runners/availability-service';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { getTeamAccess } from '@/lib/security/permissions';
import { createRoutePerfTracker, measureJsonBytes } from '@/lib/core/route-perf';

const logger = createLogger('api:teams:runner-inventory');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const perf = createRoutePerfTracker('/api/teams/[id]/runner-inventory', request);
    const authPayload = await perf.measureAuth(() => verifyAuth(request));
    if (!authPayload) {
        const body = { error: 'Unauthorized' };
        perf.log(logger, { statusCode: 401, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body, { status: 401 });
    }

    try {
        const userId = await perf.measureAuth(() => resolveUserId(authPayload));
        if (!userId) {
            const body = { error: 'Unauthorized' };
            perf.log(logger, { statusCode: 401, responseBytes: measureJsonBytes(body) });
            return NextResponse.json(body, { status: 401 });
        }

        const { id: teamId } = await params;
        const access = await perf.measureDb(() => getTeamAccess(userId, teamId));
        if (!access.isMember) {
            const body = { error: 'Forbidden' };
            perf.log(logger, { statusCode: 403, responseBytes: measureJsonBytes(body) });
            return NextResponse.json(body, { status: 403 });
        }

        const [overview, availability] = await perf.measureDb(() => Promise.all([
            getTeamRunnersOverview(teamId),
            getTeamDevicesAvailability(teamId),
        ]));

        const body = {
            ...overview,
            availableDeviceCount: availability.availableDeviceCount,
            staleDeviceCount: availability.staleDeviceCount,
            devices: availability.devices,
            canManageRunners: access.isMember,
        };
        perf.log(logger, { statusCode: 200, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body);
    } catch (error) {
        logger.error('Failed to load team runner inventory', error);
        const body = { error: 'Failed to load team runner inventory' };
        perf.log(logger, { statusCode: 500, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body, { status: 500 });
    }
}
