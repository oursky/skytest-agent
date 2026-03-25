import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveOrCreateUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { config as appConfig } from '@/config/app';
import { RUN_ACTIVE_STATUSES } from '@/types';
import { createMeasuredJsonResponse, createRoutePerfTracker } from '@/lib/core/route-perf';
import {
    parseCurrentTeamCookie,
    setCurrentTeamCookie,
} from '@/lib/core/current-team-cookie';

const logger = createLogger('api:projects:bootstrap');

export async function GET(request: Request) {
    const perf = createRoutePerfTracker('/api/projects/bootstrap', request);
    const authPayload = await perf.measureAuth(() => verifyAuth(request));
    if (!authPayload) {
        const body = { error: 'Unauthorized' };
        const { response, responseBytes } = createMeasuredJsonResponse(body, { status: 401 });
        perf.log(logger, { statusCode: 401, responseBytes });
        return response;
    }

    const userId = await perf.measureAuth(() => resolveOrCreateUserId(authPayload));
    if (!userId) {
        const body = { error: 'Unauthorized' };
        const { response, responseBytes } = createMeasuredJsonResponse(body, { status: 401 });
        perf.log(logger, { statusCode: 401, responseBytes });
        return response;
    }

    try {
        const url = new URL(request.url);
        const requestedTeamId = url.searchParams.get('teamId')?.trim() || null;
        const cookieTeamId = parseCurrentTeamCookie(request);

        const memberships = await perf.measureDb(() => prisma.teamMembership.findMany({
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
        }));

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
            ? await perf.measureDb(() => prisma.project.findMany({
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
            }))
            : [];

        const projectIds = projects.map((project) => project.id);
        const activeProjectRows = projectIds.length > 0
            ? await perf.measureDb(() => prisma.testCase.findMany({
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
            }))
            : [];
        const activeProjectIds = new Set(activeProjectRows.map((row) => row.projectId));

        const responseBody = {
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
        };
        const { response, responseBytes } = createMeasuredJsonResponse(responseBody);
        perf.log(logger, { statusCode: 200, responseBytes });

        if (teamId && teamId !== cookieTeamId) {
            setCurrentTeamCookie(response, teamId);
        }

        return response;
    } catch (error) {
        logger.error('Failed to resolve projects bootstrap payload', error);
        const body = { error: 'Failed to fetch projects bootstrap payload' };
        const { response, responseBytes } = createMeasuredJsonResponse(body, { status: 500 });
        perf.log(logger, { statusCode: 500, responseBytes });
        return response;
    }
}
