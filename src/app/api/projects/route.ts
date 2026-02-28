import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId, type AuthPayload } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

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
        const projects = await prisma.project.findMany({
            where: {
                userId,
            },
            orderBy: {
                updatedAt: 'desc',
            },
            include: {
                _count: {
                    select: { testCases: true },
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
        const { name } = body;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return NextResponse.json({ error: 'Valid project name is required' }, { status: 400 });
        }

        const userId = await resolveOrCreateUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const project = await prisma.project.create({
            data: {
                name: name.trim(),
                userId,
            },
        });

        return NextResponse.json(project);
    } catch (error) {
        logger.error('Failed to create project', error);
        return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
    }
}
