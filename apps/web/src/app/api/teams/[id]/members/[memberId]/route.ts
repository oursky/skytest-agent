import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
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
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Team member not found' });
        }

        if (membership.role === 'OWNER') {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Transfer ownership before removing the owner' });
        }

        await prisma.teamMembership.delete({ where: { id: memberId } });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to remove team member', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to remove team member' });
    }
}
