import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { deleteObjectIfExists } from '@/lib/storage/object-store-utils';
import { config as appConfig } from '@/config/app';
import { RUN_ACTIVE_STATUSES } from '@/types';
import { resolveProjectForbiddenOrNotFound } from '@/lib/security/resource-access-errors';

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
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const project = await prisma.project.findFirst({
            where: {
                id,
                team: {
                    memberships: {
                        some: { userId },
                    },
                },
            },
            select: {
                id: true,
                name: true,
                maxConcurrentRuns: true,
                teamId: true,
                createdByUserId: true,
                createdAt: true,
                updatedAt: true,
                team: {
                    select: {
                        memberships: {
                            where: { userId },
                            select: { role: true },
                            take: 1,
                        },
                    },
                },
            },
        });

        if (!project) {
            const accessError = await resolveProjectForbiddenOrNotFound(id);
            return NextResponse.json({ error: accessError.message }, { status: accessError.status });
        }

        const currentUserRole = project.team.memberships[0]?.role ?? null;

        return NextResponse.json({
            id: project.id,
            name: project.name,
            maxConcurrentRuns: project.maxConcurrentRuns,
            teamId: project.teamId,
            createdByUserId: project.createdByUserId,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            maxConcurrentRunsLimit: appConfig.runner.maxProjectConcurrentRuns,
            canManageProject: true,
            canDeleteProject: currentUserRole === 'OWNER',
        });
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
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const existingProject = await prisma.project.findFirst({
            where: {
                id,
                team: {
                    memberships: {
                        some: { userId },
                    },
                },
            },
            select: { id: true },
        });

        if (!existingProject) {
            const accessError = await resolveProjectForbiddenOrNotFound(id);
            return NextResponse.json({ error: accessError.message }, { status: accessError.status });
        }

        const body = await request.json() as {
            name?: unknown;
            maxConcurrentRuns?: unknown;
        };
        const hasName = body.name !== undefined;
        const hasMaxConcurrentRuns = body.maxConcurrentRuns !== undefined;

        if (!hasName && !hasMaxConcurrentRuns) {
            return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
        }

        const data: {
            name?: string;
            maxConcurrentRuns?: number;
        } = {};

        if (hasName) {
            const name = typeof body.name === 'string' ? body.name.trim() : '';
            if (!name) {
                return NextResponse.json({ error: 'Name is required' }, { status: 400 });
            }
            data.name = name;
        }

        if (hasMaxConcurrentRuns) {
            const maxConcurrentRunsInput = body.maxConcurrentRuns;
            if (typeof maxConcurrentRunsInput !== 'number' || !Number.isInteger(maxConcurrentRunsInput)) {
                return NextResponse.json({ error: 'maxConcurrentRuns must be an integer' }, { status: 400 });
            }
            if (maxConcurrentRunsInput < 1 || maxConcurrentRunsInput > appConfig.runner.maxProjectConcurrentRuns) {
                return NextResponse.json({
                    error: `maxConcurrentRuns must be between 1 and ${appConfig.runner.maxProjectConcurrentRuns}`,
                }, { status: 400 });
            }
            data.maxConcurrentRuns = maxConcurrentRunsInput;
        }

        const project = await prisma.project.update({
            where: { id },
            data,
            select: {
                id: true,
                name: true,
                maxConcurrentRuns: true,
                teamId: true,
                createdByUserId: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return NextResponse.json({
            ...project,
            maxConcurrentRunsLimit: appConfig.runner.maxProjectConcurrentRuns,
        });
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
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const existingProject = await prisma.project.findFirst({
            where: {
                id,
                team: {
                    memberships: {
                        some: {
                            userId,
                            role: 'OWNER',
                        },
                    },
                },
            },
            select: { id: true },
        });

        if (!existingProject) {
            const accessError = await resolveProjectForbiddenOrNotFound(id);
            return NextResponse.json({ error: accessError.message }, { status: accessError.status });
        }

        const activeRuns = await prisma.testRun.findFirst({
            where: {
                testCase: {
                    projectId: id
                },
                status: {
                    in: [...RUN_ACTIVE_STATUSES]
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
