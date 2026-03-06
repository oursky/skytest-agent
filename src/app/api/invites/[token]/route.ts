import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { hashInviteToken } from '@/lib/security/invite-token';

const logger = createLogger('api:invites:token');
const CURRENT_TEAM_COOKIE = 'skytest_current_team';

function getPayloadEmail(authPayload: Record<string, unknown>): string | null {
    const email = authPayload.email;
    return typeof email === 'string' && email.length > 0 ? email.toLowerCase() : null;
}

async function resolveOrUpdateUser(
    authPayload: Record<string, unknown> & { sub?: string }
): Promise<{ id: string; email: string | null } | null> {
    const userId = await resolveUserId(authPayload);
    const authId = typeof authPayload.sub === 'string' ? authPayload.sub : null;
    const payloadEmail = getPayloadEmail(authPayload);

    if (userId) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true }
        });
        if (!user) {
            return null;
        }
        if (payloadEmail && user.email !== payloadEmail) {
            await prisma.user.update({
                where: { id: userId },
                data: { email: payloadEmail }
            });
            return { id: user.id, email: payloadEmail };
        }
        return user;
    }

    if (!authId) {
        return null;
    }

    return prisma.user.upsert({
        where: { authId },
        update: { email: payloadEmail ?? undefined },
        create: {
            authId,
            email: payloadEmail,
        },
        select: {
            id: true,
            email: true,
        }
    });
}

function deriveInviteStatus(invite: { status: string; expiresAt: Date }): string {
    if (invite.status === 'PENDING' && invite.expiresAt.getTime() < Date.now()) {
        return 'EXPIRED';
    }
    return invite.status;
}

async function findInvite(rawToken: string) {
    return prisma.teamInvite.findUnique({
        where: { tokenHash: hashInviteToken(rawToken) },
        include: {
            team: {
                select: {
                    id: true,
                    name: true,
                }
            }
        }
    });
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await params;
        const invite = await findInvite(token);

        if (!invite) {
            return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
        }

        return NextResponse.json({
            id: invite.id,
            email: invite.email,
            role: invite.role,
            status: deriveInviteStatus(invite),
            expiresAt: invite.expiresAt,
            team: invite.team,
        });
    } catch (error) {
        logger.error('Failed to fetch invite', error);
        return NextResponse.json({ error: 'Failed to fetch invite' }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ token: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { token } = await params;
        const { action } = await request.json() as { action?: string };

        if (action !== 'accept' && action !== 'decline') {
            return NextResponse.json({ error: 'Valid invite action is required' }, { status: 400 });
        }

        const user = await resolveOrUpdateUser(authPayload as Record<string, unknown> & { sub?: string });
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const invite = await findInvite(token);
        if (!invite) {
            return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
        }

        const derivedStatus = deriveInviteStatus(invite);
        if (derivedStatus !== 'PENDING') {
            if (derivedStatus === 'EXPIRED' && invite.status !== 'EXPIRED') {
                await prisma.teamInvite.update({
                    where: { id: invite.id },
                    data: { status: 'EXPIRED' }
                });
            }
            return NextResponse.json({ error: `Invite is ${derivedStatus.toLowerCase()}` }, { status: 400 });
        }

        if (!user.email || user.email.toLowerCase() !== invite.email.toLowerCase()) {
            return NextResponse.json(
                { error: 'Signed-in account email does not match this invite' },
                { status: 403 }
            );
        }

        if (action === 'decline') {
            await prisma.teamInvite.update({
                where: { id: invite.id },
                data: {
                    status: 'DECLINED',
                    declinedAt: new Date(),
                }
            });

            return NextResponse.json({ success: true, status: 'DECLINED' });
        }

        await prisma.$transaction(async (tx) => {
            const orgMembership = await tx.teamMembership.findUnique({
                where: {
                    teamId_userId: {
                        teamId: invite.team.id,
                        userId: user.id,
                    }
                },
                select: { id: true, role: true }
            });

            if (!orgMembership) {
                await tx.teamMembership.create({
                    data: {
                        teamId: invite.team.id,
                        userId: user.id,
                        role: invite.role,
                    }
                });
            } else if (orgMembership.role !== 'OWNER' && orgMembership.role !== invite.role) {
                await tx.teamMembership.update({
                    where: { id: orgMembership.id },
                    data: {
                        role: invite.role,
                    }
                });
            }

            await tx.teamInvite.update({
                where: { id: invite.id },
                data: {
                    status: 'ACCEPTED',
                    acceptedAt: new Date(),
                }
            });
        });

        const response = NextResponse.json({
            success: true,
            status: 'ACCEPTED',
            teamId: invite.team.id,
        });
        response.cookies.set(CURRENT_TEAM_COOKIE, invite.team.id, {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
        });
        return response;
    } catch (error) {
        logger.error('Failed to process invite', error);
        return NextResponse.json({ error: 'Failed to process invite' }, { status: 500 });
    }
}
