import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { canManageOrganizationMembers, isOrganizationMember } from '@/lib/security/permissions';
import { generateInviteToken, hashInviteToken } from '@/lib/security/invite-token';

const logger = createLogger('api:organizations:invites');
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_ROLES = new Set(['ADMIN', 'MEMBER']);

function deriveInviteStatus(invite: { status: string; expiresAt: Date }) {
    if (invite.status === 'PENDING' && invite.expiresAt.getTime() < Date.now()) {
        return 'EXPIRED';
    }
    return invite.status;
}

function buildInviteUrl(request: Request, token: string) {
    const url = new URL(request.url);
    return `${url.origin}/invites/${token}`;
}

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

        const { id } = await params;
        if (!await isOrganizationMember(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const invites = await prisma.organizationInvite.findMany({
            where: { organizationId: id },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                email: true,
                role: true,
                status: true,
                expiresAt: true,
                acceptedAt: true,
                declinedAt: true,
                canceledAt: true,
                createdAt: true,
                updatedAt: true,
                invitedByUser: {
                    select: {
                        id: true,
                        email: true,
                    }
                }
            }
        });

        return NextResponse.json({
            canManageInvites: await canManageOrganizationMembers(userId, id),
            invites: invites.map((invite) => ({
                ...invite,
                status: deriveInviteStatus(invite),
                invitedByUserId: invite.invitedByUser.id,
                invitedByEmail: invite.invitedByUser.email,
                invitedByUser: undefined,
            })),
        });
    } catch (error) {
        logger.error('Failed to list organization invites', error);
        return NextResponse.json({ error: 'Failed to load team invites' }, { status: 500 });
    }
}

export async function POST(
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

        const { id } = await params;
        if (!await canManageOrganizationMembers(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json() as { email?: string; role?: string };
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const role = typeof body.role === 'string' ? body.role.trim() : '';

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }
        if (!INVITE_ROLES.has(role)) {
            return NextResponse.json({ error: 'Valid team role is required' }, { status: 400 });
        }

        const existingMember = await prisma.organizationMembership.findFirst({
            where: {
                organizationId: id,
                user: {
                    email,
                }
            },
            select: { id: true }
        });
        if (existingMember) {
            return NextResponse.json({ error: 'User is already in this team' }, { status: 409 });
        }

        const existingPendingInvite = await prisma.organizationInvite.findFirst({
            where: {
                organizationId: id,
                email,
                status: 'PENDING',
                expiresAt: {
                    gt: new Date(),
                }
            },
            select: { id: true }
        });
        if (existingPendingInvite) {
            return NextResponse.json({ error: 'An active invite already exists for this email' }, { status: 409 });
        }

        const rawToken = generateInviteToken();
        const tokenHash = hashInviteToken(rawToken);

        const invite = await prisma.organizationInvite.create({
            data: {
                organizationId: id,
                email,
                role: role as 'ADMIN' | 'MEMBER',
                tokenHash,
                expiresAt: new Date(Date.now() + INVITE_TTL_MS),
                invitedByUserId: userId,
            },
            select: {
                id: true,
                email: true,
                role: true,
                status: true,
                expiresAt: true,
                acceptedAt: true,
                declinedAt: true,
                canceledAt: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        return NextResponse.json({
            ...invite,
            inviteUrl: buildInviteUrl(request, rawToken),
        }, { status: 201 });
    } catch (error) {
        logger.error('Failed to create organization invite', error);
        return NextResponse.json({ error: 'Failed to create team invite' }, { status: 500 });
    }
}
