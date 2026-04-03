import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { isTeamMember } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';

const logger = createLogger('api:teams:members:id');

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; memberId: string }> }
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
        const { teamId: id, params: { memberId } } = guard;

        const membership = await prisma.teamMembership.findUnique({
            where: { id: memberId },
            select: {
                id: true,
                teamId: true,
                role: true,
            }
        });

        if (!membership || membership.teamId !== id) {
            return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
        }

        if (membership.role === 'OWNER') {
            return NextResponse.json({ error: 'Transfer ownership before removing the owner' }, { status: 400 });
        }

        await prisma.teamMembership.delete({ where: { id: memberId } });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to remove team member', error);
        return NextResponse.json({ error: 'Failed to remove team member' }, { status: 500 });
    }
}
