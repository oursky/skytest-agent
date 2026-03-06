import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { canManageTeamMembers, getTeamRole } from '@/lib/security/permissions';

const logger = createLogger('api:teams:members:id');
const ROLE_OPTIONS = new Set(['ADMIN', 'MEMBER']);

export async function PATCH(
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

        const actorRole = await getTeamRole(userId, id);
        if (!actorRole || actorRole === 'MEMBER') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json() as { role?: string };
        const role = typeof body.role === 'string' ? body.role.trim() : '';
        if (!ROLE_OPTIONS.has(role)) {
            return NextResponse.json({ error: 'Valid team role is required' }, { status: 400 });
        }

        const membership = await prisma.teamMembership.findUnique({
            where: { id: memberId },
            select: {
                id: true,
                teamId: true,
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

        if (!membership || membership.teamId !== id) {
            return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
        }

        if (membership.role === role) {
            return NextResponse.json({
                id: membership.id,
                userId: membership.userId,
                email: membership.email ?? membership.user?.email ?? null,
                role: membership.role,
                createdAt: membership.createdAt,
                updatedAt: membership.updatedAt,
            });
        }

        if (membership.role === 'OWNER') {
            return NextResponse.json({ error: 'Transfer ownership before changing the owner role' }, { status: 400 });
        }

        await prisma.teamMembership.update({
            where: { id: memberId },
            data: { role: role as 'ADMIN' | 'MEMBER' },
        });

        const updatedMembership = await prisma.teamMembership.findUnique({
            where: { id: memberId },
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

        if (!updatedMembership) {
            return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
        }

        return NextResponse.json({
            id: updatedMembership.id,
            userId: updatedMembership.userId,
            email: updatedMembership.email ?? updatedMembership.user?.email ?? null,
            role: updatedMembership.role,
            createdAt: updatedMembership.createdAt,
            updatedAt: updatedMembership.updatedAt,
        });
    } catch (error) {
        logger.error('Failed to update team member role', error);
        return NextResponse.json({ error: 'Failed to update team member role' }, { status: 500 });
    }
}

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
