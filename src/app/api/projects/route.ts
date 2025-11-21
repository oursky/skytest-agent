import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

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
            },
        });

        return NextResponse.json(projects);
    } catch (error) {
        console.error('Failed to fetch projects:', error);
        return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, userId } = body;

        if (!name || !userId) {
            return NextResponse.json({ error: 'Name and User ID are required' }, { status: 400 });
        }

        // Ensure user exists
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
                name,
                userId: user.id,
            },
        });

        return NextResponse.json(project);
    } catch (error) {
        console.error('Failed to create project:', error);
        return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
    }
}
