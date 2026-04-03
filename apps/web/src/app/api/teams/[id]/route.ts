import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import {
    canDeleteTeam,
    canTransferTeamOwnership,
    getTeamRole,
    isTeamMember,
    isTeamOwner,
} from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';
import { deleteObjectIfExists } from '@/lib/storage/object-store-utils';
import { RUN_ACTIVE_STATUSES } from '@/types';

const logger = createLogger('api:teams:id');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTeamRouteRequest({
        request,
        params,
        authorize: ({ userId, teamId }) => isTeamMember(userId, teamId),
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { userId, teamId: id } = guard;

        const team = await prisma.team.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                openRouterKeyUpdatedAt: true,
                createdAt: true,
                updatedAt: true,
                _count: {
                    select: {
                        memberships: true,
                        projects: true,
                    }
                }
            }
        });

        if (!team) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Team not found' });
        }

        const role = await getTeamRole(userId, id);
        const owner = role === 'OWNER';

        return NextResponse.json({
            ...team,
            role,
            canRename: owner,
            canDelete: await canDeleteTeam(userId, id),
            canTransferOwnership: await canTransferTeamOwnership(userId, id),
        });
    } catch (error) {
        logger.error('Failed to fetch team', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to fetch team' });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTeamRouteRequest({
        request,
        params,
        authorize: ({ userId, teamId }) => isTeamOwner(userId, teamId),
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { teamId: id } = guard;

        const body = await request.json() as { name?: string };
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Team name is required' });
        }

        const team = await prisma.team.update({
            where: { id },
            data: { name },
            select: {
                id: true,
                name: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        return NextResponse.json(team);
    } catch (error) {
        logger.error('Failed to update team', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to update team' });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTeamRouteRequest({
        request,
        params,
        authorize: ({ userId, teamId }) => canDeleteTeam(userId, teamId),
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { teamId: id } = guard;

        const activeRun = await prisma.testRun.findFirst({
            where: {
                testCase: {
                    project: {
                        teamId: id,
                    }
                },
                status: {
                    in: [...RUN_ACTIVE_STATUSES]
                }
            },
            select: { id: true }
        });

        if (activeRun) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Cannot delete team while tests are running or queued' });
        }

        const projects = await prisma.project.findMany({
            where: { teamId: id },
            select: {
                id: true,
                configs: {
                    where: { type: 'FILE' },
                    select: { value: true }
                },
                testCases: {
                    select: {
                        files: { select: { storedName: true } },
                        configs: {
                            where: { type: 'FILE' },
                            select: { value: true }
                        }
                    }
                }
            }
        });

        await prisma.team.delete({ where: { id } });

        const objectKeys = projects.flatMap((project) => [
            ...project.configs.map((config) => config.value),
            ...project.testCases.flatMap((testCase) => [
                ...testCase.files.map((file) => file.storedName),
                ...testCase.configs.map((config) => config.value),
            ])
        ]);

        await Promise.all(objectKeys.map(async (objectKey) => {
            try {
                await deleteObjectIfExists(objectKey);
            } catch {
                logger.warn('Failed to delete object from storage', { objectKey });
            }
        }));

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete team', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to delete team' });
    }
}
