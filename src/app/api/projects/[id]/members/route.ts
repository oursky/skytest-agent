import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import {
    canManageProjectMembers,
    canViewProjectMembers,
    getProjectOrganizationMembership,
} from '@/lib/security/permissions';

const logger = createLogger('api:projects:members');

const PROJECT_ROLES = new Set(['ADMIN', 'MEMBER']);

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

        const members = await prisma.projectMembership.findMany({
            where: { projectId: id },
            orderBy: [
                { role: 'asc' },
                { user: { email: 'asc' } },
                { createdAt: 'asc' },
            ],
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

        return NextResponse.json(members.map((member) => ({
            id: member.id,
            userId: member.user.id,
            email: member.user.email,
            role: member.role,
            createdAt: member.createdAt,
            updatedAt: member.updatedAt,
        })));
    } catch (error) {
        logger.error('Failed to list project members', error);
        return NextResponse.json({ error: 'Failed to list project members' }, { status: 500 });
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

        const body = await request.json() as { userId?: string; role?: string };
        const targetUserId = typeof body.userId === 'string' ? body.userId.trim() : '';
        const role = typeof body.role === 'string' ? body.role.trim() : '';

        if (!targetUserId) {
            return NextResponse.json({ error: 'User is required' }, { status: 400 });
        }
        if (!PROJECT_ROLES.has(role)) {
            return NextResponse.json({ error: 'Valid project role is required' }, { status: 400 });
        }

        const projectContext = await getProjectOrganizationMembership(userId, id);
        if (!projectContext) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        const targetOrgMembership = await prisma.organizationMembership.findUnique({
            where: {
                organizationId_userId: {
                    organizationId: projectContext.organizationId,
                    userId: targetUserId,
                }
            },
            select: { id: true }
        });

        if (!targetOrgMembership) {
            return NextResponse.json(
                { error: 'User must belong to the organization before joining this project' },
                { status: 400 }
            );
        }

        const existingMembership = await prisma.projectMembership.findUnique({
            where: {
                projectId_userId: {
                    projectId: id,
                    userId: targetUserId,
                }
            },
            select: { id: true }
        });

        if (existingMembership) {
            return NextResponse.json({ error: 'User is already a project member' }, { status: 409 });
        }

        const membership = await prisma.projectMembership.create({
            data: {
                projectId: id,
                userId: targetUserId,
                role: role as 'ADMIN' | 'MEMBER',
            },
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
            id: membership.id,
            userId: membership.user.id,
            email: membership.user.email,
            role: membership.role,
            createdAt: membership.createdAt,
            updatedAt: membership.updatedAt,
        }, { status: 201 });
    } catch (error) {
        logger.error('Failed to add project member', error);
        return NextResponse.json({ error: 'Failed to add project member' }, { status: 500 });
    }
}
