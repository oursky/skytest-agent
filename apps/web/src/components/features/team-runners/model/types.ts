export interface TeamRunnerItem {
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

export interface TeamRunnersResponse {
    teamId: string;
    runnerConnected: boolean;
    macRunnerOnlineCount: number;
    canManageRunners: boolean;
    refreshedAt: string;
    runners: TeamRunnerItem[];
}

export interface TeamDeviceItem {
    id: string;
    runnerId: string;
    runnerLabel: string;
    deviceId: string;
    name: string;
    platform: string;
    state: string;
    metadata?: Record<string, unknown> | null;
    lastSeenAt: string;
    isFresh: boolean;
    isAvailable: boolean;
}

export interface TeamDevicesResponse {
    teamId: string;
    runnerConnected: boolean;
    availableDeviceCount: number;
    staleDeviceCount: number;
    refreshedAt: string;
    devices: TeamDeviceItem[];
}
