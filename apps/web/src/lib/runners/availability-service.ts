import { prisma } from '@/lib/core/prisma';

const DEVICE_FRESHNESS_WINDOW_MS = 45_000;
const TEAM_AVAILABILITY_CACHE_TTL_MS = 5_000;
const EMULATOR_PROFILE_DEVICE_PREFIX = 'emulator-profile:';
const ACTIVE_RUN_STATUSES = ['PREPARING', 'RUNNING'] as const;

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
    runnerDisplayId: string;
    runnerLabel: string;
    deviceId: string;
    name: string;
    platform: string;
    state: string;
    metadata: Record<string, unknown> | null;
    lastSeenAt: string;
    isFresh: boolean;
    isAvailable: boolean;
    activeRunId: string | null;
    activeProjectId: string | null;
    activeProjectName: string | null;
    inUseByAnotherTeam: boolean;
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
    displayId: string;
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
    macRunnerOnlineCount: number;
    runners: TeamRunnerRow[];
    refreshedAt: string;
}

const teamDevicesCache = new Map<string, CachedTeamDevices>();
const teamRunnersCache = new Map<string, CachedTeamRunners>();

export function invalidateTeamAvailabilityCache(teamId: string): void {
    teamDevicesCache.delete(teamId);
    teamRunnersCache.delete(teamId);
}

function normalizeDeviceMetadata(value: unknown): Record<string, unknown> | null {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
        return null;
    }
    return value as Record<string, unknown>;
}

function readMetadataString(metadata: Record<string, unknown> | null, key: string): string | null {
    if (!metadata) {
        return null;
    }
    const value = metadata[key];
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

interface NormalizedRunnerDeviceRow {
    id: string;
    deviceId: string;
    platform: string;
    name: string;
    state: string;
    metadata: Record<string, unknown> | null;
    lastSeenAt: Date;
}

function isConnectedEmulatorDevice(device: NormalizedRunnerDeviceRow): boolean {
    const inventoryKind = readMetadataString(device.metadata, 'inventoryKind');
    const kind = readMetadataString(device.metadata, 'kind');
    return (inventoryKind === 'connected-device' && kind === 'emulator')
        || (device.deviceId.startsWith('emulator-') && !device.deviceId.startsWith(EMULATOR_PROFILE_DEVICE_PREFIX));
}

function dedupeRunnerDevices(devices: ReadonlyArray<TeamRunnerWithDevices['devices'][number]>): NormalizedRunnerDeviceRow[] {
    const normalizedDevices = devices.map((device) => ({
        id: device.id,
        deviceId: device.deviceId,
        platform: device.platform,
        name: device.name,
        state: device.state,
        metadata: normalizeDeviceMetadata(device.metadata),
        lastSeenAt: device.lastSeenAt,
    }));

    return normalizedDevices.filter((device) => {
        return !isConnectedEmulatorDevice(device);
    });
}

interface TeamRunnerWithDevices {
    id: string;
    displayId: string;
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
        metadata: unknown;
        lastSeenAt: Date;
    }>;
}

interface ActiveDeviceRunProjection {
    runId: string;
    runnerId: string;
    requestedDeviceId: string;
    projectId: string;
    projectName: string;
    teamId: string;
}

async function loadTeamRunners(teamId: string): Promise<TeamRunnerWithDevices[]> {
    return prisma.runner.findMany({
        where: { teamId },
        select: {
            id: true,
            displayId: true,
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
                    metadata: true,
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
    const teamRunnerIds = new Set(runners.map((runner) => runner.id));
    const teamDeviceIds = new Set<string>();
    for (const runner of runners) {
        const dedupedDevices = dedupeRunnerDevices(runner.devices);
        for (const device of dedupedDevices) {
            teamDeviceIds.add(device.deviceId);
        }
    }

    const activeDeviceRuns: ActiveDeviceRunProjection[] = teamDeviceIds.size > 0
        ? (await prisma.testRun.findMany({
            where: {
                status: { in: [...ACTIVE_RUN_STATUSES] },
                assignedRunnerId: { not: null },
                requestedDeviceId: { in: Array.from(teamDeviceIds) },
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                assignedRunnerId: true,
                requestedDeviceId: true,
                testCase: {
                    select: {
                        projectId: true,
                        project: {
                            select: {
                                name: true,
                                teamId: true,
                            },
                        },
                    },
                },
            },
        })).flatMap((run) => {
            if (!run.assignedRunnerId || !run.requestedDeviceId) {
                return [];
            }
            return [{
                runId: run.id,
                runnerId: run.assignedRunnerId,
                requestedDeviceId: run.requestedDeviceId,
                projectId: run.testCase.projectId,
                projectName: run.testCase.project.name,
                teamId: run.testCase.project.teamId,
            }];
        })
        : [];

    const activeRunByRunnerAndDevice = new Map<string, ActiveDeviceRunProjection>();
    const inUseByOtherTeamDeviceIds = new Set<string>();
    for (const run of activeDeviceRuns) {
        if (run.teamId === teamId && teamRunnerIds.has(run.runnerId)) {
            const key = `${run.runnerId}:${run.requestedDeviceId}`;
            if (!activeRunByRunnerAndDevice.has(key)) {
                activeRunByRunnerAndDevice.set(key, run);
            }
            continue;
        }
        if (run.teamId !== teamId) {
            inUseByOtherTeamDeviceIds.add(run.requestedDeviceId);
        }
    }

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

        const dedupedDevices = dedupeRunnerDevices(runner.devices);
        for (const device of dedupedDevices) {
            const deviceFresh = device.lastSeenAt.getTime() >= staleThresholdMs;
            const isAvailable = runnerFresh && deviceFresh && device.state === 'ONLINE';
            const occupancyKey = `${runner.id}:${device.deviceId}`;
            const activeRun = activeRunByRunnerAndDevice.get(occupancyKey);

            if (isAvailable) {
                availableDeviceCount += 1;
            } else if (device.state === 'ONLINE' && !deviceFresh) {
                staleDeviceCount += 1;
            }

            devices.push({
                id: device.id,
                runnerId: runner.id,
                runnerDisplayId: runner.displayId,
                runnerLabel: runner.label,
                deviceId: device.deviceId,
                name: device.name,
                platform: device.platform,
                state: device.state,
                metadata: device.metadata,
                lastSeenAt: device.lastSeenAt.toISOString(),
                isFresh: deviceFresh,
                isAvailable,
                activeRunId: activeRun?.runId ?? null,
                activeProjectId: activeRun?.projectId ?? null,
                activeProjectName: activeRun?.projectName ?? null,
                inUseByAnotherTeam: !activeRun
                    && inUseByOtherTeamDeviceIds.has(device.deviceId),
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
    let macRunnerOnlineCount = 0;

    const rows: TeamRunnerRow[] = runners.map((runner) => {
        const runnerFresh = runner.status === 'ONLINE' && runner.lastSeenAt.getTime() >= staleThresholdMs;
        if (runnerFresh) {
            runnerConnected = true;
            if (runner.kind === 'MACOS_AGENT') {
                macRunnerOnlineCount += 1;
            }
        }

        const dedupedDevices = dedupeRunnerDevices(runner.devices);
        const availableDeviceCount = dedupedDevices.reduce((count, device) => {
            const deviceFresh = device.lastSeenAt.getTime() >= staleThresholdMs;
            if (runnerFresh && deviceFresh && device.state === 'ONLINE') {
                return count + 1;
            }
            return count;
        }, 0);

        return {
            id: runner.id,
            displayId: runner.displayId,
            label: runner.label,
            kind: runner.kind,
            status: runner.status,
            protocolVersion: runner.protocolVersion,
            runnerVersion: runner.runnerVersion,
            lastSeenAt: runner.lastSeenAt.toISOString(),
            isFresh: runnerFresh,
            deviceCount: dedupedDevices.length,
            availableDeviceCount,
        };
    });

    const payload: TeamRunnersOverview = {
        teamId,
        runnerConnected,
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
