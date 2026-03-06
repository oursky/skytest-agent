import { prisma } from '@/lib/core/prisma';

const DEVICE_FRESHNESS_WINDOW_MS = 45_000;
const PROJECT_DEVICES_CACHE_TTL_MS = 5_000;

interface CachedProjectDevices {
    expiresAtMs: number;
    payload: ProjectDevicesAvailability;
}

interface ProjectDeviceRow {
    id: string;
    runnerId: string;
    runnerLabel: string;
    deviceId: string;
    name: string;
    platform: string;
    state: string;
    lastSeenAt: string;
    isFresh: boolean;
    isAvailable: boolean;
}

export interface ProjectDevicesAvailability {
    projectId: string;
    runnerConnected: boolean;
    availableDeviceCount: number;
    staleDeviceCount: number;
    devices: ProjectDeviceRow[];
    refreshedAt: string;
}

const projectDevicesCache = new Map<string, CachedProjectDevices>();

export async function getProjectDevicesAvailability(projectId: string): Promise<ProjectDevicesAvailability | null> {
    const nowMs = Date.now();
    const cached = projectDevicesCache.get(projectId);
    if (cached && cached.expiresAtMs > nowMs) {
        return cached.payload;
    }

    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
            id: true,
            teamId: true,
        },
    });

    if (!project) {
        return null;
    }

    const runners = await prisma.runner.findMany({
        where: { teamId: project.teamId },
        select: {
            id: true,
            label: true,
            status: true,
            lastSeenAt: true,
            devices: {
                select: {
                    id: true,
                    deviceId: true,
                    platform: true,
                    name: true,
                    state: true,
                    lastSeenAt: true,
                },
            },
        },
    });

    const staleThresholdMs = nowMs - DEVICE_FRESHNESS_WINDOW_MS;
    const devices: ProjectDeviceRow[] = [];
    let availableDeviceCount = 0;
    let staleDeviceCount = 0;
    let runnerConnected = false;

    for (const runner of runners) {
        const runnerFresh = runner.status === 'ONLINE' && runner.lastSeenAt.getTime() >= staleThresholdMs;
        if (runnerFresh) {
            runnerConnected = true;
        }

        for (const device of runner.devices) {
            const deviceFresh = device.lastSeenAt.getTime() >= staleThresholdMs;
            const isAvailable = runnerFresh && deviceFresh && device.state === 'ONLINE';

            if (isAvailable) {
                availableDeviceCount += 1;
            } else if (device.state === 'ONLINE' && !deviceFresh) {
                staleDeviceCount += 1;
            }

            devices.push({
                id: device.id,
                runnerId: runner.id,
                runnerLabel: runner.label,
                deviceId: device.deviceId,
                name: device.name,
                platform: device.platform,
                state: device.state,
                lastSeenAt: device.lastSeenAt.toISOString(),
                isFresh: deviceFresh,
                isAvailable,
            });
        }
    }

    const payload: ProjectDevicesAvailability = {
        projectId,
        runnerConnected,
        availableDeviceCount,
        staleDeviceCount,
        devices,
        refreshedAt: new Date(nowMs).toISOString(),
    };

    projectDevicesCache.set(projectId, {
        expiresAtMs: nowMs + PROJECT_DEVICES_CACHE_TTL_MS,
        payload,
    });

    return payload;
}
