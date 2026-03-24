import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveOrCreateUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { config as appConfig } from '@/config/app';
import { RUN_ACTIVE_STATUSES } from '@/types';

const logger = createLogger('api:projects:bootstrap');
const CURRENT_TEAM_COOKIE = 'skytest_current_team';
const isSecureCookie = process.env.NODE_ENV === 'production';

function parseCookieValue(cookieHeader: string, name: string): string | null {
    const encoded = cookieHeader
        .split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${name}=`))
        ?.slice(name.length + 1);

    return encoded ? decodeURIComponent(encoded) : null;
}

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveOrCreateUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const url = new URL(request.url);
        const requestedTeamId = url.searchParams.get('teamId')?.trim() || null;
        const cookieTeamId = parseCookieValue(request.headers.get('cookie') ?? '', CURRENT_TEAM_COOKIE);

        const memberships = await prisma.teamMembership.findMany({
            where: { userId },
            orderBy: {
                team: {
                    updatedAt: 'desc',
                }
            },
            select: {
                role: true,
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

        const teams = memberships.map((membership) => ({
            ...membership.team,
            role: membership.role,
        }));

        const selectedTeam = (requestedTeamId
            ? teams.find((team) => team.id === requestedTeamId)
            : null)
            ?? (cookieTeamId ? teams.find((team) => team.id === cookieTeamId) : null)
            ?? teams[0]
            ?? null;

        const teamId = selectedTeam?.id ?? null;
        const projects = teamId
            ? await prisma.project.findMany({
                where: {
                    teamId,
                },
                orderBy: {
                    updatedAt: 'desc',
                },
                include: {
                    _count: {
                        select: { testCases: true },
                    },
                    team: {
                        select: {
                            memberships: {
                                where: { userId },
                                select: { role: true },
                                take: 1,
                            }
                        }
                    }
                },
            })
            : [];

        const projectIds = projects.map((project) => project.id);
        const activeProjectRows = projectIds.length > 0
            ? await prisma.testCase.findMany({
                where: {
                    projectId: { in: projectIds },
                    testRuns: {
                        some: {
                            status: {
                                in: [...RUN_ACTIVE_STATUSES]
                            }
                        }
                    }
                },
                select: { projectId: true },
                distinct: ['projectId'],
            })
            : [];
        const activeProjectIds = new Set(activeProjectRows.map((row) => row.projectId));

        const response = NextResponse.json({
            teams,
            currentTeam: selectedTeam
                ? {
                    id: selectedTeam.id,
                    name: selectedTeam.name,
                    createdAt: selectedTeam.createdAt,
                    updatedAt: selectedTeam.updatedAt,
                }
                : null,
            projects: projects.map((project) => ({
                ...project,
                hasActiveRuns: activeProjectIds.has(project.id),
                currentUserRole: project.team.memberships[0]?.role ?? null,
                maxConcurrentRunsLimit: appConfig.runner.maxProjectConcurrentRuns,
                team: undefined,
            })),
        });

        if (teamId && teamId !== cookieTeamId) {
            response.cookies.set(CURRENT_TEAM_COOKIE, teamId, {
                httpOnly: true,
                sameSite: 'lax',
                secure: isSecureCookie,
                path: '/',
            });
        }

        return response;
    } catch (error) {
        logger.error('Failed to resolve projects bootstrap payload', error);
        return NextResponse.json({ error: 'Failed to fetch projects bootstrap payload' }, { status: 500 });
    }
}
