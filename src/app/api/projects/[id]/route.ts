import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { deleteObjectIfExists } from '@/lib/storage/object-store-utils';

const logger = createLogger('api:projects:id');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
        const project = await prisma.project.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                createdAt: true,
                updatedAt: true,
                userId: true,
            },
        });

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        if (project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        return NextResponse.json(project);
    } catch (error) {
        logger.error('Failed to fetch project', error);
        return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 });
    }
}


export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;

        const existingProject = await prisma.project.findUnique({
            where: { id },
            select: { userId: true }
        });

        if (!existingProject) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        if (existingProject.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const { name } = body;

        if (!name) {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 });
        }

        const project = await prisma.project.update({
            where: { id },
            data: { name },
        });

        return NextResponse.json(project);
    } catch (error) {
        logger.error('Failed to update project', error);
        return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;

        const existingProject = await prisma.project.findUnique({
            where: { id },
            select: { userId: true }
        });

        if (!existingProject) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        if (existingProject.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const activeRuns = await prisma.testRun.findFirst({
            where: {
                testCase: {
                    projectId: id
                },
                status: {
                    in: ['RUNNING', 'QUEUED', 'PREPARING']
                }
            }
        });

        if (activeRuns) {
            return NextResponse.json(
                { error: 'Cannot delete project while tests are running or queued' },
                { status: 400 }
            );
        }

        const testCases = await prisma.testCase.findMany({
            where: { projectId: id },
            select: {
                id: true,
                files: { select: { storedName: true } },
                configs: {
                    where: { type: 'FILE' },
                    select: { value: true }
                }
            }
        });

        const projectConfigFiles = await prisma.projectConfig.findMany({
            where: {
                projectId: id,
                type: 'FILE'
            },
            select: { value: true }
        });

        await prisma.project.delete({
            where: { id },
        });

        const objectKeys = [
            ...projectConfigFiles.map((config) => config.value),
            ...testCases.flatMap((testCase) => [
                ...testCase.files.map((file) => file.storedName),
                ...testCase.configs.map((config) => config.value),
            ])
        ];

        await Promise.all(objectKeys.map(async (objectKey) => {
            try {
                await deleteObjectIfExists(objectKey);
            } catch {
                logger.warn('Failed to delete object from storage', { objectKey });
            }
        }));

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete project', error);
        return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
    }
}
