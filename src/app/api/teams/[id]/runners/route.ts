import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { getTeamRunnersOverview } from '@/lib/runners/availability-service';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { getTeamAccess } from '@/lib/security/permissions';

const logger = createLogger('api:teams:runners');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id: teamId } = await params;
        const access = await getTeamAccess(userId, teamId);
        if (!access.isMember) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const overview = await getTeamRunnersOverview(teamId);

        return NextResponse.json({
            ...overview,
            canManageRunners: access.isMember,
        });
    } catch (error) {
        logger.error('Failed to load team runners', error);
        return NextResponse.json({ error: 'Failed to load team runners' }, { status: 500 });
    }
}
