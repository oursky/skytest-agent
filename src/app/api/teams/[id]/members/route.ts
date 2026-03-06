import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { canManageTeamMembers, isTeamMember } from '@/lib/security/permissions';

const logger = createLogger('api:teams:members');
const MANAGEABLE_ROLES = new Set(['ADMIN', 'MEMBER']);

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
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
        if (!await isTeamMember(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const members = await prisma.teamMembership.findMany({
            where: { teamId: id },
            orderBy: [
                { role: 'asc' },
                { email: 'asc' },
                { createdAt: 'asc' },
            ],
            select: {
                id: true,
                userId: true,
                email: true,
                role: true,
                createdAt: true,
                updatedAt: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                    }
                }
            }
        });

        return NextResponse.json({
            canManageMembers: await canManageTeamMembers(userId, id),
            members: members.map((member) => ({
                id: member.id,
                userId: member.userId,
                email: member.email ?? member.user?.email ?? null,
                role: member.role,
                createdAt: member.createdAt,
                updatedAt: member.updatedAt,
            })),
        });
    } catch (error) {
        logger.error('Failed to list team members', error);
        return NextResponse.json({ error: 'Failed to load team members' }, { status: 500 });
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
        if (!await canManageTeamMembers(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json() as { email?: string; role?: string };
        const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
        const role = typeof body.role === 'string' ? body.role.trim() : 'MEMBER';

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        if (!MANAGEABLE_ROLES.has(role)) {
            return NextResponse.json({ error: 'Valid team role is required' }, { status: 400 });
        }

        const existingUser = await prisma.user.findFirst({
            where: { email },
            select: { id: true }
        });

        const existingMembership = await prisma.teamMembership.findFirst({
            where: {
                teamId: id,
                OR: [
                    { email },
                    ...(existingUser ? [{ userId: existingUser.id }] : []),
                ],
            },
            select: { id: true }
        });

        if (existingMembership) {
            return NextResponse.json({ error: 'Member already exists in this team' }, { status: 409 });
        }

        const membership = await prisma.teamMembership.create({
            data: {
                teamId: id,
                email,
                role: role as 'ADMIN' | 'MEMBER',
                ...(existingUser ? { userId: existingUser.id } : {}),
            },
            select: {
                id: true,
                userId: true,
                email: true,
                role: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        return NextResponse.json(membership, { status: 201 });
    } catch (error) {
        logger.error('Failed to add team member', error);
        return NextResponse.json({ error: 'Failed to add team member' }, { status: 500 });
    }
}
