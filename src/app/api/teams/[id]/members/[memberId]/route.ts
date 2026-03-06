import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { canManageOrganizationMembers } from '@/lib/security/permissions';

const logger = createLogger('api:teams:members:id');
const MANAGEABLE_ROLES = new Set(['ADMIN', 'MEMBER']);

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
        if (!await canManageOrganizationMembers(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json() as { role?: string };
        const role = typeof body.role === 'string' ? body.role.trim() : '';
        if (!MANAGEABLE_ROLES.has(role)) {
            return NextResponse.json({ error: 'Valid team role is required' }, { status: 400 });
        }

        const membership = await prisma.organizationMembership.findUnique({
            where: { id: memberId },
            select: {
                id: true,
                organizationId: true,
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

        if (!membership || membership.organizationId !== id) {
            return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
        }

        if (membership.role === 'OWNER') {
            return NextResponse.json({ error: 'Transfer ownership instead of changing the owner role' }, { status: 400 });
        }

        const updated = await prisma.organizationMembership.update({
            where: { id: memberId },
            data: { role: role as 'ADMIN' | 'MEMBER' },
            select: {
                id: true,
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
            id: updated.id,
            userId: updated.user.id,
            email: updated.user.email,
            role: updated.role,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
        });
    } catch (error) {
        logger.error('Failed to update organization member', error);
        return NextResponse.json({ error: 'Failed to update team member' }, { status: 500 });
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
        if (!await canManageOrganizationMembers(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const membership = await prisma.organizationMembership.findUnique({
            where: { id: memberId },
            select: {
                id: true,
                organizationId: true,
                role: true,
            }
        });

        if (!membership || membership.organizationId !== id) {
            return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
        }

        if (membership.role === 'OWNER') {
            return NextResponse.json({ error: 'Transfer ownership before removing the owner' }, { status: 400 });
        }

        await prisma.organizationMembership.delete({ where: { id: memberId } });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to remove organization member', error);
        return NextResponse.json({ error: 'Failed to remove team member' }, { status: 500 });
    }
}
