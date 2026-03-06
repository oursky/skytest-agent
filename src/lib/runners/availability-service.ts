import { prisma } from '@/lib/core/prisma';

const DEVICE_FRESHNESS_WINDOW_MS = 45_000;
const TEAM_AVAILABILITY_CACHE_TTL_MS = 5_000;

interface CachedTeamDevices {
    expiresAtMs: number;
    payload: TeamDevicesAvailability;
}

interface CachedTeamRunners {
    expiresAtMs: number;
    payload: TeamRunnersOverview;
}

interface TeamDeviceRow {
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

export interface TeamDevicesAvailability {
    teamId: string;
    runnerConnected: boolean;
    availableDeviceCount: number;
    staleDeviceCount: number;
    devices: TeamDeviceRow[];
    refreshedAt: string;
}

export interface TeamRunnerRow {
    id: string;
    label: string;
    kind: string;
    status: string;
    protocolVersion: string;
    runnerVersion: string;
    lastSeenAt: string;
    isFresh: boolean;
    deviceCount: number;
    availableDeviceCount: number;
}

export interface TeamRunnersOverview {
    teamId: string;
    runnerConnected: boolean;
    browserRunnerOnlineCount: number;
    macRunnerOnlineCount: number;
    runners: TeamRunnerRow[];
    refreshedAt: string;
}

const teamDevicesCache = new Map<string, CachedTeamDevices>();
const teamRunnersCache = new Map<string, CachedTeamRunners>();

interface TeamRunnerWithDevices {
    id: string;
    label: string;
    kind: string;
    status: string;
    protocolVersion: string;
    runnerVersion: string;
    lastSeenAt: Date;
    devices: Array<{
        id: string;
        deviceId: string;
        platform: string;
        name: string;
        state: string;
        lastSeenAt: Date;
    }>;
}

async function loadTeamRunners(teamId: string): Promise<TeamRunnerWithDevices[]> {
    return prisma.runner.findMany({
        where: { teamId },
        select: {
            id: true,
            label: true,
            kind: true,
            status: true,
            protocolVersion: true,
            runnerVersion: true,
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
}

export async function getTeamDevicesAvailability(teamId: string): Promise<TeamDevicesAvailability> {
    const nowMs = Date.now();
    const cached = teamDevicesCache.get(teamId);
    if (cached && cached.expiresAtMs > nowMs) {
        return cached.payload;
    }

    const runners = await loadTeamRunners(teamId);

    const staleThresholdMs = nowMs - DEVICE_FRESHNESS_WINDOW_MS;
    const devices: TeamDeviceRow[] = [];
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

    const payload: TeamDevicesAvailability = {
        teamId,
        runnerConnected,
        availableDeviceCount,
        staleDeviceCount,
        devices,
        refreshedAt: new Date(nowMs).toISOString(),
    };

    teamDevicesCache.set(teamId, {
        expiresAtMs: nowMs + TEAM_AVAILABILITY_CACHE_TTL_MS,
        payload,
    });

    return payload;
}

export async function getTeamRunnersOverview(teamId: string): Promise<TeamRunnersOverview> {
    const nowMs = Date.now();
    const cached = teamRunnersCache.get(teamId);
    if (cached && cached.expiresAtMs > nowMs) {
        return cached.payload;
    }

    const runners = await loadTeamRunners(teamId);
    const staleThresholdMs = nowMs - DEVICE_FRESHNESS_WINDOW_MS;
    let runnerConnected = false;
    let browserRunnerOnlineCount = 0;
    let macRunnerOnlineCount = 0;

    const rows: TeamRunnerRow[] = runners.map((runner) => {
        const runnerFresh = runner.status === 'ONLINE' && runner.lastSeenAt.getTime() >= staleThresholdMs;
        if (runnerFresh) {
            runnerConnected = true;
            if (runner.kind === 'HOSTED_BROWSER') {
                browserRunnerOnlineCount += 1;
            }
            if (runner.kind === 'MACOS_AGENT') {
                macRunnerOnlineCount += 1;
            }
        }

        const availableDeviceCount = runner.devices.reduce((count, device) => {
            const deviceFresh = device.lastSeenAt.getTime() >= staleThresholdMs;
            if (runnerFresh && deviceFresh && device.state === 'ONLINE') {
                return count + 1;
            }
            return count;
        }, 0);

        return {
            id: runner.id,
            label: runner.label,
            kind: runner.kind,
            status: runner.status,
            protocolVersion: runner.protocolVersion,
            runnerVersion: runner.runnerVersion,
            lastSeenAt: runner.lastSeenAt.toISOString(),
            isFresh: runnerFresh,
            deviceCount: runner.devices.length,
            availableDeviceCount,
        };
    });

    const payload: TeamRunnersOverview = {
        teamId,
        runnerConnected,
        browserRunnerOnlineCount,
        macRunnerOnlineCount,
        runners: rows.sort((a, b) => a.label.localeCompare(b.label)),
        refreshedAt: new Date(nowMs).toISOString(),
    };

    teamRunnersCache.set(teamId, {
        expiresAtMs: nowMs + TEAM_AVAILABILITY_CACHE_TTL_MS,
        payload,
    });

    return payload;
}
