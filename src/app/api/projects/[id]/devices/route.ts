import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { getProjectDevicesAvailability } from '@/lib/runners/availability-service';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { isProjectMember } from '@/lib/security/permissions';

const logger = createLogger('api:projects:devices');

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

        const { id: projectId } = await params;
        if (!await isProjectMember(userId, projectId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const availability = await getProjectDevicesAvailability(projectId);
        if (!availability) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        return NextResponse.json(availability);
    } catch (error) {
        logger.error('Failed to load project devices', error);
        return NextResponse.json({ error: 'Failed to load project devices' }, { status: 500 });
    }
}
