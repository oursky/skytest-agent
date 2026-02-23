import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { emulatorPool } from '@/lib/emulator-pool';
import { createLogger } from '@/lib/logger';
import { getAndroidAccessStatusForUser } from '@/lib/user-features';

const logger = createLogger('api:emulators:apps');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const androidAccessStatus = await getAndroidAccessStatusForUser(userId);
    if (androidAccessStatus !== 'enabled') {
        return NextResponse.json(
            {
                error: androidAccessStatus === 'runtime-unavailable'
                    ? 'Android testing is not available on this server'
                    : 'Android testing is not enabled for your account'
            },
            { status: androidAccessStatus === 'runtime-unavailable' ? 503 : 403 }
        );
    }

    const { searchParams } = new URL(request.url);
    const emulatorId = searchParams.get('emulatorId')?.trim() ?? '';
    if (!emulatorId) {
        return NextResponse.json({ error: 'emulatorId is required' }, { status: 400 });
    }

    try {
        const projects = await prisma.project.findMany({
            where: { userId },
            select: { id: true },
        });
        const projectIds = new Set(projects.map((project) => project.id));

        const status = emulatorPool.getStatus(projectIds);
        const emulator = status.emulators.find((item) => item.id === emulatorId);
        if (!emulator) {
            return NextResponse.json({ error: `Emulator "${emulatorId}" is not available` }, { status: 404 });
        }

        const appIds = await emulatorPool.listInstalledPackages(emulatorId);
        return NextResponse.json(appIds);
    } catch (error) {
        logger.error('Failed to list installed app IDs', error);
        return NextResponse.json({ error: 'Failed to list installed app IDs' }, { status: 500 });
    }
}
