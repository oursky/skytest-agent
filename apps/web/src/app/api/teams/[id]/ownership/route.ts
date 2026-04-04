import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { canTransferTeamOwnership } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';
import { apiError } from '@/lib/security/api-route-standards';

const logger = createLogger('api:teams:ownership');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTeamRouteRequest({
        request,
        params,
        authorize: ({ userId, teamId }) => canTransferTeamOwnership(userId, teamId),
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { userId, teamId: id } = guard;

        const body = await request.json() as { email?: string };
        const nextOwnerEmail = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
        if (!nextOwnerEmail) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'Email is required',
            });
        }
        if (!EMAIL_PATTERN.test(nextOwnerEmail)) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'Valid email is required',
            });
        }

        const [currentOwnerMembership, nextOwnerMembership] = await Promise.all([
            prisma.teamMembership.findUnique({
                where: {
                    teamId_userId: {
                        teamId: id,
                        userId,
                    }
                },
                select: { id: true }
            }),
            prisma.teamMembership.findFirst({
                where: {
                    teamId: id,
                    OR: [
                        { email: nextOwnerEmail },
                        { user: { is: { email: nextOwnerEmail } } },
                    ],
                },
                select: {
                    id: true,
                    role: true,
                    userId: true,
                    email: true,
                    user: {
                        select: {
                            id: true,
                            email: true,
                        }
                    }
                }
            }),
        ]);

        if (!currentOwnerMembership) {
            return apiError({
                status: 403,
                code: 'FORBIDDEN',
                error: 'Only the current owner can transfer ownership',
            });
        }

        if (!nextOwnerMembership) {
            return apiError({
                status: 404,
                code: 'NOT_FOUND',
                error: 'Team member not found',
            });
        }
        if (nextOwnerMembership.role === 'OWNER') {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'Choose a different member as the next owner',
            });
        }
        if (!nextOwnerMembership.userId || !nextOwnerMembership.user) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'Team member must join before ownership transfer',
            });
        }

        await prisma.$transaction([
            prisma.teamMembership.update({
                where: { id: currentOwnerMembership.id },
                data: { role: 'MEMBER' },
            }),
            prisma.teamMembership.update({
                where: { id: nextOwnerMembership.id },
                data: { role: 'OWNER' },
            }),
        ]);

        return NextResponse.json({
            success: true,
            owner: {
                userId: nextOwnerMembership.user.id,
                email: nextOwnerMembership.user.email,
            }
        });
    } catch (error) {
        logger.error('Failed to transfer team ownership', error);
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to transfer team ownership',
        });
    }
}
