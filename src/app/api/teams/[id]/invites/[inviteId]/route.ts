import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { canManageTeamMembers } from '@/lib/security/permissions';

const logger = createLogger('api:teams:invites:id');

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; inviteId: string }> }
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

        const { id, inviteId } = await params;
        if (!await canManageTeamMembers(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const invite = await prisma.teamInvite.findUnique({
            where: { id: inviteId },
            select: {
                id: true,
                teamId: true,
                status: true,
            }
        });

        if (!invite || invite.teamId !== id) {
            return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
        }

        if (invite.status === 'ACCEPTED') {
            return NextResponse.json({ error: 'Accepted invites cannot be canceled' }, { status: 400 });
        }

        await prisma.teamInvite.update({
            where: { id: inviteId },
            data: {
                status: 'CANCELED',
                canceledAt: new Date(),
            }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to cancel team invite', error);
        return NextResponse.json({ error: 'Failed to cancel team invite' }, { status: 500 });
    }
}
