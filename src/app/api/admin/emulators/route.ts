import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { emulatorPool } from '@/lib/emulator-pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:admin:emulators');

export const dynamic = 'force-dynamic';

async function isAndroidEnabled(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { androidEnabled: true },
    });
    return user?.androidEnabled ?? false;
}

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId || !(await isAndroidEnabled(userId))) {
        return NextResponse.json({ error: 'Android testing is not enabled for your account' }, { status: 403 });
    }

    try {
        const status = emulatorPool.getStatus();
        return NextResponse.json(status);
    } catch (error) {
        logger.error('Failed to get emulator pool status', error);
        return NextResponse.json({ error: 'Failed to get pool status' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId || !(await isAndroidEnabled(userId))) {
        return NextResponse.json({ error: 'Android testing is not enabled for your account' }, { status: 403 });
    }

    try {
        const body = await request.json() as { action: string; emulatorId?: string; avdName?: string };
        const { action, emulatorId, avdName } = body;

        if (action === 'stop' && emulatorId) {
            await emulatorPool.stop(emulatorId);
            return NextResponse.json({ success: true });
        }

        if (action === 'boot' && avdName) {
            const profile = await prisma.avdProfile.findUnique({
                where: { name: avdName },
                select: { dockerImage: true },
            });
            logger.info('Emulator boot requested', { avdName, userId });
            await emulatorPool.boot(avdName, profile?.dockerImage ?? undefined);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error) {
        logger.error('Failed to execute emulator action', error);
        return NextResponse.json({ error: 'Failed to execute action' }, { status: 500 });
    }
}
