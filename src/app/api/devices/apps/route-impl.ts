import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { androidDeviceManager } from '@/lib/android-device-manager';
import { createLogger } from '@/lib/logger';
import { getAndroidAccessStatusForUser } from '@/lib/user-features';

const logger = createLogger('api:devices:apps');

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
    const deviceId = (searchParams.get('deviceId') ?? '').trim();
    if (!deviceId) {
        return NextResponse.json({ error: 'deviceId is required' }, { status: 400 });
    }

    try {
        const projects = await prisma.project.findMany({
            where: { userId },
            select: { id: true },
        });
        const projectIds = new Set(projects.map((project) => project.id));

        const status = androidDeviceManager.getStatus(projectIds);
        const activeManagedDevice = status.devices.find((item) => item.id === deviceId);
        if (activeManagedDevice && activeManagedDevice.state === 'ACQUIRED' && activeManagedDevice.runProjectId) {
            if (!projectIds.has(activeManagedDevice.runProjectId)) {
                return NextResponse.json({ error: `Device "${deviceId}" is not available` }, { status: 404 });
            }
        }

        const appIds = await androidDeviceManager.listInstalledPackages(deviceId);
        return NextResponse.json(appIds);
    } catch (error) {
        logger.error('Failed to list installed app IDs', error);
        return NextResponse.json({ error: 'Failed to list installed app IDs' }, { status: 500 });
    }
}
