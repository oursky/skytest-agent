import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveOrCreateUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { canCreateProject, isTeamMember } from '@/lib/security/permissions';

const logger = createLogger('api:projects');

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
        const { searchParams } = new URL(request.url);
        const teamId = searchParams.get('teamId')?.trim() || null;

        if (teamId) {
            const hasTeamAccess = await isTeamMember(userId, teamId);
            if (!hasTeamAccess) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
                },
                testCases: {
                    select: {
                        testRuns: {
                            where: {
                                status: {
                                    in: ['RUNNING', 'QUEUED', 'PREPARING']
                                }
                            },
                            select: {
                                id: true
                            },
                            take: 1
                        }
                    }
                }
            },
        });

        const projectsWithStatus = projects.map(project => ({
            ...project,
            hasActiveRuns: project.testCases.some(tc => tc.testRuns.length > 0),
            currentUserRole: project.team.memberships[0]?.role ?? null,
            team: undefined,
            testCases: undefined
        }));

        return NextResponse.json(projectsWithStatus);
    } catch (error) {
        logger.error('Failed to fetch projects', error);
        return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const authPayload = await verifyAuth(request);
        if (!authPayload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const teamId = typeof body.teamId === 'string' ? body.teamId.trim() : '';

        if (!name) {
            return NextResponse.json({ error: 'Valid project name is required' }, { status: 400 });
        }

        if (!teamId) {
            return NextResponse.json({ error: 'Team is required' }, { status: 400 });
        }

        const userId = await resolveOrCreateUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const canCreate = await canCreateProject(userId, teamId);
        if (!canCreate) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const project = await prisma.project.create({
            data: {
                name,
                teamId,
                createdByUserId: userId,
            },
            select: {
                id: true,
                name: true,
                teamId: true,
                createdByUserId: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        return NextResponse.json(project);
    } catch (error) {
        logger.error('Failed to create project', error);
        return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
    }
}
