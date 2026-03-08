import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { invalidateTeamAvailabilityCache } from '@/lib/runners/availability-service';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { getTeamAccess } from '@/lib/security/permissions';

const logger = createLogger('api:teams:runners:runner');

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; runnerId: string }> }
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

        const { id: teamId, runnerId } = await params;
        const access = await getTeamAccess(userId, teamId);
        if (access.role !== 'OWNER' && access.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const deleted = await prisma.runner.deleteMany({
            where: {
                id: runnerId,
                teamId,
            },
        });

        if (deleted.count === 0) {
            return NextResponse.json({ error: 'Runner not found' }, { status: 404 });
        }

        invalidateTeamAvailabilityCache(teamId);

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to unpair runner', error);
        return NextResponse.json({ error: 'Failed to unpair runner' }, { status: 500 });
    }
}
