import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { getTeamDevicesAvailability } from '@/lib/runners/availability-service';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { isTeamMember } from '@/lib/security/permissions';

const logger = createLogger('api:teams:devices');

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
        if (!await isTeamMember(userId, teamId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const availability = await getTeamDevicesAvailability(teamId);
        return NextResponse.json(availability);
    } catch (error) {
        logger.error('Failed to load team devices', error);
        return NextResponse.json({ error: 'Failed to load team devices' }, { status: 500 });
    }
}
