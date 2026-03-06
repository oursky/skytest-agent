import { useEffect, useState } from 'react';
import { buildAuthHeaders } from '@/components/features/configurations/model/config-utils';
import { AndroidDeviceOption } from '../model/device-utils';

interface UseAndroidDeviceOptionsParams {
    projectId?: string;
    readOnly?: boolean;
    getAccessToken: () => Promise<string | null>;
}

interface ProjectDevice {
    id: string;
    deviceId: string;
    name: string;
    state: string;
    isFresh: boolean;
    isAvailable: boolean;
}

interface ProjectDevicesResponse {
    devices: ProjectDevice[];
}

function buildStatusMeta(device: ProjectDevice): { statusKey: string; statusColorClass: string; disabled: boolean } {
    if (device.isAvailable) {
        return {
            statusKey: 'device.state.online',
            statusColorClass: 'bg-green-100 text-green-700',
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
    projectId,
    readOnly,
    getAccessToken,
}: UseAndroidDeviceOptionsParams): AndroidDeviceOption[] {
    const [androidDeviceOptions, setAndroidDeviceOptions] = useState<AndroidDeviceOption[]>([]);

    useEffect(() => {
        if (readOnly || !projectId) {
            return;
        }

        const fetchProjectDevices = async () => {
            const token = await getAccessToken();
            const res = await fetch(
                `/api/projects/${encodeURIComponent(projectId)}/devices`,
                { headers: buildAuthHeaders(token) }
            );
            if (!res.ok) {
                return;
            }

            const payload = await res.json() as ProjectDevicesResponse;
            const options: AndroidDeviceOption[] = payload.devices.map((device) => {
                const statusMeta = buildStatusMeta(device);

                return {
                    id: `android:${device.id}`,
                    selector: { mode: 'connected-device', serial: device.deviceId },
                    label: device.name,
                    detail: device.deviceId,
                    statusKey: statusMeta.statusKey,
                    statusColorClass: statusMeta.statusColorClass,
                    disabled: statusMeta.disabled,
                    group: 'physical',
                };
            });

            setAndroidDeviceOptions(options);
        };

        void fetchProjectDevices().catch(() => {});
    }, [projectId, getAccessToken, readOnly]);

    if (readOnly || !projectId) {
        return [];
    }

    return androidDeviceOptions;
}
