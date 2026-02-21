import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { config } from '@/config/app';

async function isAndroidEnabled(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { androidEnabled: true },
    });
    return user?.androidEnabled ?? false;
}

const logger = createLogger('api:projects:avd-profiles');

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId || !(await isAndroidEnabled(userId))) {
        return NextResponse.json({ error: 'Android testing is not enabled for your account' }, { status: 403 });
    }

    const { id } = await params;

    try {
        const project = await prisma.project.findUnique({
            where: { id },
            select: { userId: true },
        });

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        if (project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const profiles = await prisma.avdProfile.findMany({
            where: { projectId: id },
            orderBy: { displayName: 'asc' },
        });

        return NextResponse.json(profiles);
    } catch (error) {
        logger.error('Failed to fetch AVD profiles', error);
        return NextResponse.json({ error: 'Failed to fetch AVD profiles' }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId || !(await isAndroidEnabled(userId))) {
        return NextResponse.json({ error: 'Android testing is not enabled for your account' }, { status: 403 });
    }

    const { id } = await params;

    try {
        const project = await prisma.project.findUnique({
            where: { id },
            include: { avdProfiles: { select: { id: true } } },
        });

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        if (project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (project.avdProfiles.length >= config.emulator.avdProfile.maxPerProject) {
            return NextResponse.json(
                { error: `Maximum ${config.emulator.avdProfile.maxPerProject} AVD profiles per project` },
                { status: 400 }
            );
        }

        const body = await request.json() as {
            name?: string;
            displayName?: string;
            apiLevel?: number;
            screenSize?: string;
            dockerImage?: string;
        };

        const { name, displayName, apiLevel, screenSize, dockerImage } = body;

        if (!name || !displayName || !apiLevel) {
            return NextResponse.json({ error: 'name, displayName, and apiLevel are required' }, { status: 400 });
        }

        if (typeof apiLevel !== 'number' || apiLevel < 1) {
            return NextResponse.json({ error: 'apiLevel must be a positive integer' }, { status: 400 });
        }

        const profile = await prisma.avdProfile.create({
            data: {
                projectId: id,
                name,
                displayName,
                apiLevel,
                screenSize: screenSize || null,
                dockerImage: dockerImage || null,
            },
        });

        return NextResponse.json(profile, { status: 201 });
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
            return NextResponse.json({ error: 'A profile with this name already exists in this project' }, { status: 409 });
        }
        logger.error('Failed to create AVD profile', error);
        return NextResponse.json({ error: 'Failed to create AVD profile' }, { status: 500 });
    }
}
