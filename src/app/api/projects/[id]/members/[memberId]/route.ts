import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { canManageProjectMembers } from '@/lib/security/permissions';

const logger = createLogger('api:projects:members:id');

const PROJECT_ROLES = new Set(['ADMIN', 'MEMBER']);

async function countProjectAdmins(projectId: string): Promise<number> {
    return prisma.projectMembership.count({
        where: {
            projectId,
            role: 'ADMIN',
        }
    });
}

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
        const canManage = await canManageProjectMembers(userId, id);
        if (!canManage) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json() as { role?: string };
        const role = typeof body.role === 'string' ? body.role.trim() : '';
        if (!PROJECT_ROLES.has(role)) {
            return NextResponse.json({ error: 'Valid project role is required' }, { status: 400 });
        }

        const membership = await prisma.projectMembership.findUnique({
            where: { id: memberId },
            select: {
                id: true,
                projectId: true,
                role: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                    }
                }
            }
        });

        if (!membership || membership.projectId !== id) {
            return NextResponse.json({ error: 'Project member not found' }, { status: 404 });
        }

        if (membership.role === 'ADMIN' && role !== 'ADMIN') {
            const adminCount = await countProjectAdmins(id);
            if (adminCount <= 1) {
                return NextResponse.json({ error: 'Project must have at least one admin' }, { status: 400 });
            }
        }

        const updatedMembership = await prisma.projectMembership.update({
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
            id: updatedMembership.id,
            userId: updatedMembership.user.id,
            email: updatedMembership.user.email,
            role: updatedMembership.role,
            createdAt: updatedMembership.createdAt,
            updatedAt: updatedMembership.updatedAt,
        });
    } catch (error) {
        logger.error('Failed to update project member', error);
        return NextResponse.json({ error: 'Failed to update project member' }, { status: 500 });
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
        const canManage = await canManageProjectMembers(userId, id);
        if (!canManage) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const membership = await prisma.projectMembership.findUnique({
            where: { id: memberId },
            select: {
                id: true,
                projectId: true,
                role: true,
            }
        });

        if (!membership || membership.projectId !== id) {
            return NextResponse.json({ error: 'Project member not found' }, { status: 404 });
        }

        if (membership.role === 'ADMIN') {
            const adminCount = await countProjectAdmins(id);
            if (adminCount <= 1) {
                return NextResponse.json({ error: 'Project must have at least one admin' }, { status: 400 });
            }
        }

        await prisma.projectMembership.delete({ where: { id: memberId } });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to remove project member', error);
        return NextResponse.json({ error: 'Failed to remove project member' }, { status: 500 });
    }
}
