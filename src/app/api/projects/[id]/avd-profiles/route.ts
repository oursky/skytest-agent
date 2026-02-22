import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { listAvailableAndroidProfiles } from '@/lib/android-profiles';
import { isAndroidEnabledForUser } from '@/lib/user-features';

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
    if (!userId || !(await isAndroidEnabledForUser(userId))) {
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

        const available = await listAvailableAndroidProfiles();
        return NextResponse.json(available.map((profile) => ({
            id: profile.id,
            name: profile.name,
            displayName: profile.displayName,
            apiLevel: profile.apiLevel,
            screenSize: profile.screenSize,
            enabled: true,
        })));
    } catch (error) {
        logger.error('Failed to fetch AVD profiles', error);
        return NextResponse.json({ error: 'Failed to fetch AVD profiles' }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    void request;
    void params;
    return NextResponse.json(
        { error: 'AVD profiles are managed by system runtime inventory and cannot be created manually.' },
        { status: 405 }
    );
}
