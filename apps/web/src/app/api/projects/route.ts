import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveOrCreateUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { isTeamMember } from '@/lib/security/permissions';
import { config as appConfig } from '@/config/app';
import { RUN_ACTIVE_STATUSES } from '@/types';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';

const logger = createLogger('api:projects');

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return apiError({ status: 401, code: 'UNAUTHORIZED', error: 'Unauthorized' });
    }

    const userId = await resolveOrCreateUserId(authPayload);

    if (!userId) {
        return apiError({ status: 401, code: 'UNAUTHORIZED', error: 'Unauthorized' });
    }

    try {
        const { searchParams } = new URL(request.url);
        const teamId = searchParams.get('teamId')?.trim() || null;

        if (teamId) {
            const hasTeamAccess = await isTeamMember(userId, teamId);
            if (!hasTeamAccess) {
                return apiError({ status: 403, code: 'FORBIDDEN', error: 'Forbidden' });
            }
        }

        const projects = await prisma.project.findMany({
            where: {
                ...(teamId ? { teamId } : {}),
                team: {
                    memberships: {
                        some: {
                            userId,
                        }
                    }
                }
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
        });

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
                select: {
                    projectId: true,
                },
                distinct: ['projectId'],
            })
            : [];
        const activeProjectIds = new Set(activeProjectRows.map((row) => row.projectId));

        const projectsWithStatus = projects.map(project => ({
            ...project,
            hasActiveRuns: activeProjectIds.has(project.id),
            currentUserRole: project.team.memberships[0]?.role ?? null,
            maxConcurrentRunsLimit: appConfig.runner.maxProjectConcurrentRuns,
            team: undefined,
        }));

        return NextResponse.json(projectsWithStatus);
    } catch (error) {
        logger.error('Failed to fetch projects', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to fetch projects' });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const teamId = typeof body.teamId === 'string' ? body.teamId.trim() : '';
        const maxConcurrentRunsInput = body.maxConcurrentRuns;

        if (!name) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Valid project name is required' });
        }

        if (!teamId) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Team is required' });
        }

        const guard = await guardTeamRouteRequest({
            request,
            params: Promise.resolve({ id: teamId }),
            authorize: ({ userId: memberUserId, teamId: memberTeamId }) => isTeamMember(memberUserId, memberTeamId),
        });
        if (!guard.ok) {
            return guard.response;
        }
        const userId = guard.userId;

        let maxConcurrentRuns = 1;
        if (maxConcurrentRunsInput !== undefined) {
            if (typeof maxConcurrentRunsInput !== 'number' || !Number.isInteger(maxConcurrentRunsInput)) {
                return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'maxConcurrentRuns must be an integer' });
            }
            if (maxConcurrentRunsInput < 1 || maxConcurrentRunsInput > appConfig.runner.maxProjectConcurrentRuns) {
                return apiError({ status: 400, code: 'VALIDATION_ERROR', error: `maxConcurrentRuns must be between 1 and ${appConfig.runner.maxProjectConcurrentRuns}` });
            }
            maxConcurrentRuns = maxConcurrentRunsInput;
        }

        const project = await prisma.project.create({
            data: {
                name,
                teamId,
                createdByUserId: userId,
                maxConcurrentRuns,
            },
            select: {
                id: true,
                name: true,
                maxConcurrentRuns: true,
                teamId: true,
                createdByUserId: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        return NextResponse.json({
            ...project,
            maxConcurrentRunsLimit: appConfig.runner.maxProjectConcurrentRuns,
        });
    } catch (error) {
        logger.error('Failed to create project', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to create project' });
    }
}
