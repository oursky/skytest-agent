import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId, type AuthPayload } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { isTeamMember } from '@/lib/security/permissions';

const logger = createLogger('api:teams:current');
const CURRENT_TEAM_COOKIE = 'skytest_current_team';

async function resolveOrCreateUserId(authPayload: AuthPayload): Promise<string | null> {
    const resolvedUserId = await resolveUserId(authPayload);
    if (resolvedUserId) {
        return resolvedUserId;
    }

    const authId = authPayload.sub as string | undefined;
    if (!authId) {
        return null;
    }

    const user = await prisma.user.upsert({
        where: { authId },
        update: {},
        create: { authId },
        select: { id: true }
    });

    return user.id;
}

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

        const cookieHeader = request.headers.get('cookie') ?? '';
        const cookieValue = cookieHeader
            .split(';')
            .map((item) => item.trim())
            .find((item) => item.startsWith(`${CURRENT_TEAM_COOKIE}=`))
            ?.split('=')[1];

        if (cookieValue) {
            const teamId = decodeURIComponent(cookieValue);
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
        response.cookies.set(CURRENT_TEAM_COOKIE, membership.team.id, {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
        });
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
        response.cookies.set(CURRENT_TEAM_COOKIE, team.id, {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
        });
        return response;
    } catch (error) {
        logger.error('Failed to persist current team', error);
        return NextResponse.json({ error: 'Failed to persist current team' }, { status: 500 });
    }
}
