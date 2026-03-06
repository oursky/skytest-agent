import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import {
    canManageProjectMembers,
    canViewProjectMembers,
} from '@/lib/security/permissions';
import { generateInviteToken, hashInviteToken } from '@/lib/security/invite-token';

const logger = createLogger('api:projects:invites');
const PROJECT_ROLES = new Set(['ADMIN', 'MEMBER']);
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function buildInviteUrl(request: Request, token: string): string {
    const url = new URL(request.url);
    return `${url.origin}/invites/${token}`;
}

function deriveInviteStatus(invite: { status: string; expiresAt: Date }): string {
    if (invite.status === 'PENDING' && invite.expiresAt.getTime() < Date.now()) {
        return 'EXPIRED';
    }
    return invite.status;
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
        const canView = await canViewProjectMembers(userId, id);
        if (!canView) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const invites = await prisma.projectInvite.findMany({
            where: { projectId: id },
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

        return NextResponse.json(invites.map((invite) => ({
            ...invite,
            status: deriveInviteStatus(invite),
            invitedByUserId: invite.invitedByUser.id,
            invitedByEmail: invite.invitedByUser.email,
            invitedByUser: undefined,
        })));
    } catch (error) {
        logger.error('Failed to list project invites', error);
        return NextResponse.json({ error: 'Failed to list project invites' }, { status: 500 });
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
        const canManage = await canManageProjectMembers(userId, id);
        if (!canManage) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json() as { email?: string; role?: string };
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const role = typeof body.role === 'string' ? body.role.trim() : '';

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }
        if (!PROJECT_ROLES.has(role)) {
            return NextResponse.json({ error: 'Valid project role is required' }, { status: 400 });
        }

        const existingPendingInvite = await prisma.projectInvite.findFirst({
            where: {
                projectId: id,
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

        const invite = await prisma.projectInvite.create({
            data: {
                projectId: id,
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
        logger.error('Failed to create project invite', error);
        return NextResponse.json({ error: 'Failed to create project invite' }, { status: 500 });
    }
}
