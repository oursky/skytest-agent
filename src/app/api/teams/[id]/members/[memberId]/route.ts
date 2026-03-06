import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { canManageTeamMembers } from '@/lib/security/permissions';

const logger = createLogger('api:teams:members:id');

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; memberId: string }> }
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

        const { id, memberId } = await params;
        if (!await canManageTeamMembers(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

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
