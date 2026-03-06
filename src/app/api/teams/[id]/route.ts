import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import {
    canDeleteOrganization,
    canRenameOrganization,
    canTransferOrganizationOwnership,
    getOrganizationRole,
    isOrganizationMember,
} from '@/lib/security/permissions';
import { deleteObjectIfExists } from '@/lib/storage/object-store-utils';

const logger = createLogger('api:teams:id');

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
        if (!await isOrganizationMember(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const organization = await prisma.organization.findUnique({
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
                        invites: true,
                    }
                }
            }
        });

        if (!organization) {
            return NextResponse.json({ error: 'Team not found' }, { status: 404 });
        }

        const role = await getOrganizationRole(userId, id);

        return NextResponse.json({
            ...organization,
            role,
            canRename: await canRenameOrganization(userId, id),
            canDelete: await canDeleteOrganization(userId, id),
            canTransferOwnership: await canTransferOrganizationOwnership(userId, id),
        });
    } catch (error) {
        logger.error('Failed to fetch organization', error);
        return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 });
    }
}

export async function PATCH(
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
        if (!await canRenameOrganization(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json() as { name?: string };
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
            return NextResponse.json({ error: 'Team name is required' }, { status: 400 });
        }

        const organization = await prisma.organization.update({
            where: { id },
            data: { name },
            select: {
                id: true,
                name: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        return NextResponse.json(organization);
    } catch (error) {
        logger.error('Failed to update organization', error);
        return NextResponse.json({ error: 'Failed to update team' }, { status: 500 });
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
        if (!await canDeleteOrganization(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const activeRun = await prisma.testRun.findFirst({
            where: {
                testCase: {
                    project: {
                        organizationId: id,
                    }
                },
                status: {
                    in: ['RUNNING', 'QUEUED', 'PREPARING']
                }
            },
            select: { id: true }
        });

        if (activeRun) {
            return NextResponse.json({ error: 'Cannot delete team while tests are running or queued' }, { status: 400 });
        }

        const projects = await prisma.project.findMany({
            where: { organizationId: id },
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

        await prisma.organization.delete({ where: { id } });

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
        logger.error('Failed to delete organization', error);
        return NextResponse.json({ error: 'Failed to delete team' }, { status: 500 });
    }
}
