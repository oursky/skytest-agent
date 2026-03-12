import { useEffect, useState } from 'react';
import { buildAuthHeaders } from '@/components/features/test-configurations/model/config-utils';
import { config as appConfig } from '@/config/app';
import { AndroidDeviceOption } from '../model/device-utils';

interface UseAndroidDeviceOptionsParams {
    teamId?: string;
    readOnly?: boolean;
    getAccessToken: () => Promise<string | null>;
}

interface TeamDevice {
    id: string;
    runnerId: string;
    runnerDisplayId?: string;
    runnerLabel: string;
    deviceId: string;
    name: string;
    state: string;
    isFresh: boolean;
    isAvailable: boolean;
    activeRunId?: string | null;
    activeProjectId?: string | null;
    activeProjectName?: string | null;
    inUseByAnotherTeam?: boolean;
    metadata?: Record<string, unknown> | null;
}

interface TeamDevicesResponse {
    devices: TeamDevice[];
}

function isEmulatorProfileInventory(device: TeamDevice): boolean {
    const inventoryKind = device.metadata?.inventoryKind;
    return inventoryKind === 'emulator-profile';
}

function resolveEmulatorProfileName(device: TeamDevice): string | null {
    const value = device.metadata?.emulatorProfileName;
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function buildStatusMeta(device: TeamDevice): {
    statusKey: string;
    statusParams?: Record<string, string | number>;
    statusColorClass: string;
    disabled: boolean;
} {
    if (device.activeRunId) {
        return {
            statusKey: 'device.inUseProject',
            statusParams: { project: device.activeProjectName ?? device.activeProjectId ?? '-' },
            statusColorClass: 'bg-amber-100 text-amber-700',
            disabled: false,
        };
    }

    if (device.inUseByAnotherTeam) {
        return {
            statusKey: 'device.inUseAnotherTeam',
            statusColorClass: 'bg-red-100 text-red-700',
            disabled: false,
        };
    }

    if (device.isAvailable) {
        return {
            statusKey: 'device.state.online',
            statusColorClass: 'bg-green-100 text-green-700',
            disabled: false,
        };
    }

    if (device.state === 'OFFLINE' && isEmulatorProfileInventory(device)) {
        return {
            statusKey: 'device.state.notRunning',
            statusColorClass: 'bg-gray-100 text-gray-600',
            disabled: false,
        };
    }

    if (device.state === 'ONLINE' && !device.isFresh) {
        return {
            statusKey: 'device.state.stale',
            statusColorClass: 'bg-amber-100 text-amber-700',
            disabled: true,
        };
    }

    if (device.state === 'UNAVAILABLE') {
        return {
            statusKey: 'device.state.unavailable',
            statusColorClass: 'bg-red-100 text-red-700',
            disabled: true,
        };
    }

    return {
        statusKey: 'device.state.offline',
        statusColorClass: 'bg-gray-100 text-gray-600',
        disabled: true,
    };
}

export function useAndroidDeviceOptions({
    teamId,
    readOnly,
    getAccessToken,
}: UseAndroidDeviceOptionsParams): AndroidDeviceOption[] {
    const [androidDeviceOptions, setAndroidDeviceOptions] = useState<AndroidDeviceOption[]>([]);

    useEffect(() => {
        if (readOnly || !teamId) {
            return;
        }

        let disposed = false;
        let fetching = false;
        const fetchTeamDevices = async () => {
            if (disposed || fetching) {
                return;
            }
            fetching = true;
            try {
                const token = await getAccessToken();
                const res = await fetch(
                    `/api/teams/${encodeURIComponent(teamId)}/devices`,
                    { headers: buildAuthHeaders(token) }
                );
                if (!res.ok) {
                    return;
                }

                const payload = await res.json() as TeamDevicesResponse;
                const options: AndroidDeviceOption[] = payload.devices.map((device) => {
                    const statusMeta = buildStatusMeta(device);
                    const emulatorProfileName = resolveEmulatorProfileName(device);
                    const isEmulatorProfile = isEmulatorProfileInventory(device) && Boolean(emulatorProfileName);
                    const baseDetail = isEmulatorProfile && emulatorProfileName ? emulatorProfileName : device.deviceId;
                    const runnerDisplayId = typeof device.runnerDisplayId === 'string'
                        ? device.runnerDisplayId.trim()
                        : '';
                    const runnerIdentity = runnerDisplayId.length > 0
                        ? runnerDisplayId
                        : device.runnerLabel;
                    const detailSegments = [baseDetail, `Runner ${runnerIdentity}`];
                    if (device.activeRunId && device.activeProjectName) {
                        detailSegments.push(device.activeProjectName);
                    }

                    return {
                        id: `android:${device.id}`,
                        runnerId: device.runnerId,
                        runnerLabel: device.runnerLabel,
                        runnerDisplayId,
                        selector: isEmulatorProfile && emulatorProfileName
                            ? { mode: 'emulator-profile', emulatorProfileName }
                            : { mode: 'connected-device', serial: device.deviceId },
                        label: device.name,
                        detail: detailSegments.join(' · '),
                        statusKey: statusMeta.statusKey,
                        statusParams: statusMeta.statusParams,
                        statusColorClass: statusMeta.statusColorClass,
                        disabled: statusMeta.disabled,
                        group: isEmulatorProfile ? 'emulator' : 'physical',
                    };
                });

                if (!disposed) {
                    setAndroidDeviceOptions(options);
                }
            } finally {
                fetching = false;
            }
        };

        void fetchTeamDevices().catch(() => {});
        const timerId = window.setInterval(() => {
            void fetchTeamDevices().catch(() => {});
        }, appConfig.ui.deviceStatusPollIntervalMs);

        return () => {
            disposed = true;
            window.clearInterval(timerId);
        };
    }, [teamId, getAccessToken, readOnly]);

    if (readOnly || !teamId) {
        return [];
    }

    return androidDeviceOptions;
}
