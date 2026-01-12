import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authPayload.sub;

    if (!userId) {
        return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    try {
        const projects = await prisma.project.findMany({
            where: {
                user: {
                    authId: userId,
                },
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
                                    in: ['RUNNING', 'QUEUED']
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
        console.error('Failed to fetch projects:', error);
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
        const userId = authPayload.sub;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return NextResponse.json({ error: 'Valid project name is required' }, { status: 400 });
        }

        if (!userId) {
            return NextResponse.json({ error: 'Valid User ID is required' }, { status: 400 });
        }

        let user = await prisma.user.findUnique({
            where: { authId: userId },
        });

        if (!user) {
            user = await prisma.user.create({
                data: { authId: userId },
            });
        }

        const project = await prisma.project.create({
            data: {
                name: name.trim(),
                userId: user.id,
            },
        });

        return NextResponse.json(project);
    } catch (error) {
        console.error('Failed to create project:', error);
        return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
    }
}
