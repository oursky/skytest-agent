import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId, type AuthPayload } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { isOrganizationMember } from '@/lib/security/permissions';

const logger = createLogger('api:projects');

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
        const organizationId = searchParams.get('organizationId')?.trim() || null;

        if (organizationId) {
            const hasOrganizationAccess = await isOrganizationMember(userId, organizationId);
            if (!hasOrganizationAccess) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const projects = await prisma.project.findMany({
            where: {
                ...(organizationId ? { organizationId } : {}),
                memberships: {
                    some: {
                        userId,
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
                memberships: {
                    where: { userId },
                    select: { role: true }
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
            currentUserRole: project.memberships[0]?.role ?? null,
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
        const organizationId = typeof body.organizationId === 'string' ? body.organizationId.trim() : '';

        if (!name) {
            return NextResponse.json({ error: 'Valid project name is required' }, { status: 400 });
        }

        if (!organizationId) {
            return NextResponse.json({ error: 'Organization is required' }, { status: 400 });
        }

        const userId = await resolveOrCreateUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const canCreateProject = await isOrganizationMember(userId, organizationId);
        if (!canCreateProject) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const project = await prisma.project.create({
            data: {
                name,
                organizationId,
                createdByUserId: userId,
                memberships: {
                    create: {
                        userId,
                        role: 'ADMIN',
                    }
                }
            },
            select: {
                id: true,
                name: true,
                organizationId: true,
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
