import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveOrCreateUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { isTeamMember } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';
import {
    parseCurrentTeamCookie,
    setCurrentTeamCookie,
} from '@/lib/core/current-team-cookie';

const logger = createLogger('api:teams:current');

async function getDefaultTeam(userId: string) {
    return prisma.teamMembership.findFirst({
        where: { userId },
        orderBy: {
            team: {
                updatedAt: 'desc',
            }
        },
        select: {
            team: {
                select: {
                    id: true,
                    name: true,
                    createdAt: true,
                    updatedAt: true,
                }
            }
        }
    });
}

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return apiError({ status: 401, code: 'UNAUTHORIZED', error: 'Unauthorized' });
    }

    try {
        const userId = await resolveOrCreateUserId(authPayload);
        if (!userId) {
            return apiError({ status: 401, code: 'UNAUTHORIZED', error: 'Unauthorized' });
        }

        const cookieValue = parseCurrentTeamCookie(request);

        if (cookieValue) {
            const teamId = cookieValue;
            const hasAccess = await isTeamMember(userId, teamId);

            if (hasAccess) {
                const team = await prisma.team.findUnique({
                    where: { id: teamId },
                    select: {
                        id: true,
                        name: true,
                        createdAt: true,
                        updatedAt: true,
                    }
                });

                if (team) {
                    return NextResponse.json(team);
                }
            }
        }

        const membership = await getDefaultTeam(userId);
        if (!membership) {
            return NextResponse.json({ team: null });
        }

        const response = NextResponse.json(membership.team);
        setCurrentTeamCookie(response, membership.team.id);
        return response;
    } catch (error) {
        logger.error('Failed to resolve current team', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to resolve current team' });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as { teamId?: string };
        const teamId = typeof body.teamId === 'string' ? body.teamId.trim() : '';
        if (!teamId) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Team is required' });
        }

        const guard = await guardTeamRouteRequest({
            request,
            params: Promise.resolve({ id: teamId }),
            authorize: ({ userId, teamId: memberTeamId }) => isTeamMember(userId, memberTeamId),
        });
        if (!guard.ok) {
            return guard.response;
        }

        const team = await prisma.team.findUnique({
            where: { id: teamId },
            select: {
                id: true,
                name: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        if (!team) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Team not found' });
        }

        const response = NextResponse.json(team);
        setCurrentTeamCookie(response, team.id);
        return response;
    } catch (error) {
        logger.error('Failed to persist current team', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to persist current team' });
    }
}
