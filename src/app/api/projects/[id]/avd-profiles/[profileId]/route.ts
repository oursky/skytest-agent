import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { ACTIVE_RUN_STATUSES } from '@/utils/statusHelpers';

const logger = createLogger('api:projects:avd-profiles:item');

export const dynamic = 'force-dynamic';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string; profileId: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, profileId } = await params;

    try {
        const profile = await prisma.avdProfile.findUnique({
            where: { id: profileId },
            include: { project: { select: { userId: true } } },
        });

        if (!profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }

        if (profile.projectId !== id) {
            return NextResponse.json({ error: 'Profile does not belong to this project' }, { status: 400 });
        }

        if (profile.project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json() as {
            name?: string;
            displayName?: string;
            apiLevel?: number;
            screenSize?: string | null;
            dockerImage?: string | null;
            enabled?: boolean;
        };

        const data: Record<string, unknown> = {};
        if (body.name !== undefined) data.name = body.name;
        if (body.displayName !== undefined) data.displayName = body.displayName;
        if (body.apiLevel !== undefined) data.apiLevel = body.apiLevel;
        if (body.screenSize !== undefined) data.screenSize = body.screenSize || null;
        if (body.dockerImage !== undefined) data.dockerImage = body.dockerImage || null;
        if (body.enabled !== undefined) data.enabled = body.enabled;

        const updated = await prisma.avdProfile.update({
            where: { id: profileId },
            data,
        });

        return NextResponse.json(updated);
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
            return NextResponse.json({ error: 'A profile with this name already exists in this project' }, { status: 409 });
        }
        logger.error('Failed to update AVD profile', error);
        return NextResponse.json({ error: 'Failed to update AVD profile' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; profileId: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, profileId } = await params;

    try {
        const profile = await prisma.avdProfile.findUnique({
            where: { id: profileId },
            include: { project: { select: { userId: true } } },
        });

        if (!profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }

        if (profile.projectId !== id) {
            return NextResponse.json({ error: 'Profile does not belong to this project' }, { status: 400 });
        }

        if (profile.project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const activeRun = await prisma.testRun.findFirst({
            where: {
                status: { in: [...ACTIVE_RUN_STATUSES] },
                configurationSnapshot: { contains: profile.name },
            },
            select: { id: true },
        });

        if (activeRun) {
            return NextResponse.json(
                { error: 'Cannot delete profile while it is referenced by an active test run.' },
                { status: 409 }
            );
        }

        await prisma.avdProfile.delete({ where: { id: profileId } });

        logger.info('AVD profile deleted', { profileId, projectId: id, userId });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete AVD profile', error);
        return NextResponse.json({ error: 'Failed to delete AVD profile' }, { status: 500 });
    }
}
