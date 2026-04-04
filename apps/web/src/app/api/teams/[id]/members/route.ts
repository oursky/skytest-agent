import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { isTeamMember } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';

const logger = createLogger('api:teams:members');
const DEFAULT_MEMBER_ROLE = 'MEMBER' as const;

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTeamRouteRequest({
        request,
        params,
        authorize: ({ userId, teamId }) => isTeamMember(userId, teamId),
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { teamId: id } = guard;
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
            canManageMembers: true,
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
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to load team members' });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTeamRouteRequest({
        request,
        params,
        authorize: ({ userId, teamId }) => isTeamMember(userId, teamId),
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { teamId: id } = guard;

        const body = await request.json() as { email?: string };
        const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';

        if (!email) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Email is required' });
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
            return apiError({ status: 409, code: 'CONFLICT', error: 'Member already exists in this team' });
        }

        const membership = await prisma.teamMembership.create({
            data: {
                teamId: id,
                email,
                role: DEFAULT_MEMBER_ROLE,
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
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to add team member' });
    }
}
