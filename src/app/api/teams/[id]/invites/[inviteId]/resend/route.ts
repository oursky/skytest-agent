import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { canManageTeamMembers } from '@/lib/security/permissions';
import { generateInviteToken, hashInviteToken } from '@/lib/security/invite-token';

const logger = createLogger('api:teams:invites:resend');
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function buildInviteUrl(request: Request, token: string) {
    const url = new URL(request.url);
    return `${url.origin}/invites/${token}`;
}

export async function POST(
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
                acceptedAt: true,
                declinedAt: true,
                canceledAt: true,
            }
        });

        if (!invite || invite.teamId !== id) {
            return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
        }

        if (invite.status === 'ACCEPTED') {
            return NextResponse.json({ error: 'Accepted invites cannot be resent' }, { status: 400 });
        }

        const rawToken = generateInviteToken();
        await prisma.teamInvite.update({
            where: { id: inviteId },
            data: {
                tokenHash: hashInviteToken(rawToken),
                status: 'PENDING',
                expiresAt: new Date(Date.now() + INVITE_TTL_MS),
                acceptedAt: null,
                declinedAt: null,
                canceledAt: null,
            }
        });

        return NextResponse.json({
            success: true,
            inviteUrl: buildInviteUrl(request, rawToken),
        });
    } catch (error) {
        logger.error('Failed to resend team invite', error);
        return NextResponse.json({ error: 'Failed to resend team invite' }, { status: 500 });
    }
}
