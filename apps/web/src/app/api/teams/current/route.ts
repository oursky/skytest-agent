import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveOrCreateUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { isTeamMember } from '@/lib/security/permissions';
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
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = await resolveOrCreateUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
        return NextResponse.json({ error: 'Failed to resolve current team' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = await resolveOrCreateUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json() as { teamId?: string };
        const teamId = typeof body.teamId === 'string' ? body.teamId.trim() : '';
        if (!teamId) {
            return NextResponse.json({ error: 'Team is required' }, { status: 400 });
        }

        const hasAccess = await isTeamMember(userId, teamId);
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
            return NextResponse.json({ error: 'Team not found' }, { status: 404 });
        }

        const response = NextResponse.json(team);
        setCurrentTeamCookie(response, team.id);
        return response;
    } catch (error) {
        logger.error('Failed to persist current team', error);
        return NextResponse.json({ error: 'Failed to persist current team' }, { status: 500 });
    }
}
