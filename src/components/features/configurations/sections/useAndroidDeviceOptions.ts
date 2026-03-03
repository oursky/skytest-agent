import { useEffect, useState } from 'react';
import { buildAuthHeaders } from '@/components/features/configurations/shared/config-utils';
import {
    ADB_STATE_PRIORITY,
    AndroidDeviceOption,
    buildAndroidDeviceOptionDetail,
    buildAndroidDeviceOptionLabel,
    buildAndroidVersionDetail,
    DEVICE_STATE_PRIORITY,
    DeviceInventoryResponse,
    getInventoryOnlyStatusColorClass,
    getInventoryOnlyStatusKey,
    getRuntimeStatusColorClass,
    getRuntimeStatusKey,
    joinAndroidDeviceDetail,
    normalizeDeviceName,
} from './device-utils';

interface UseAndroidDeviceOptionsParams {
    projectId?: string;
    readOnly?: boolean;
    getAccessToken: () => Promise<string | null>;
}

export function useAndroidDeviceOptions({
    projectId,
    readOnly,
    getAccessToken,
}: UseAndroidDeviceOptionsParams): AndroidDeviceOption[] {
    const [androidDeviceOptions, setAndroidDeviceOptions] = useState<AndroidDeviceOption[]>([]);

    useEffect(() => {
        if (readOnly || !projectId) {
            setAndroidDeviceOptions([]);
            return;
        }

        const fetchDeviceInventory = async () => {
            const token = await getAccessToken();
            const res = await fetch(
                `/api/devices?projectId=${encodeURIComponent(projectId)}`,
                { headers: buildAuthHeaders(token) }
            );

            if (!res.ok) {
                return;
            }

            const payload = await res.json() as DeviceInventoryResponse;

            const runtimeBySerial = new Map<string, DeviceInventoryResponse['devices'][number]>();
            const runtimeByEmulatorProfile = new Map<string, DeviceInventoryResponse['devices'][number]>();
            for (const runtime of payload.devices) {
                runtimeBySerial.set(runtime.serial, runtime);
                if (runtime.kind === 'emulator' && runtime.emulatorProfileName) {
                    const key = normalizeDeviceName(runtime.emulatorProfileName);
                    const existing = runtimeByEmulatorProfile.get(key);
                    if (!existing || DEVICE_STATE_PRIORITY[runtime.state] < DEVICE_STATE_PRIORITY[existing.state]) {
                        runtimeByEmulatorProfile.set(key, runtime);
                    }
                }
            }

            const connectedPhysicalDevices = payload.connectedDevices.filter((device) => device.kind === 'physical');
            const physicalOptions: AndroidDeviceOption[] = connectedPhysicalDevices.map((device) => {
                const runtime = runtimeBySerial.get(device.serial);
                return {
                    id: `physical:${device.serial}`,
                    selector: { mode: 'connected-device', serial: device.serial },
                    label: buildAndroidDeviceOptionLabel(device),
                    detail: buildAndroidDeviceOptionDetail(device),
                    statusKey: runtime ? getRuntimeStatusKey(runtime, projectId) : getInventoryOnlyStatusKey(device),
                    statusColorClass: runtime ? getRuntimeStatusColorClass(runtime) : getInventoryOnlyStatusColorClass(device),
                    disabled: device.adbState !== 'device',
                    group: 'physical',
                };
            });

            const connectedEmulatorsBySerial = new Map<string, DeviceInventoryResponse['connectedDevices'][number]>();
            const connectedEmulatorsByProfile = new Map<string, DeviceInventoryResponse['connectedDevices'][number]>();
            for (const connected of payload.connectedDevices) {
                if (connected.kind !== 'emulator') continue;
                connectedEmulatorsBySerial.set(connected.serial, connected);
                if (!connected.emulatorProfileName) continue;
                const key = normalizeDeviceName(connected.emulatorProfileName);
                const existing = connectedEmulatorsByProfile.get(key);
                if (!existing || ADB_STATE_PRIORITY[connected.adbState] < ADB_STATE_PRIORITY[existing.adbState]) {
                    connectedEmulatorsByProfile.set(key, connected);
                }
            }

            const emulatorOptions: AndroidDeviceOption[] = [];
            const usedConnectedEmulatorSerials = new Set<string>();
            const usedRuntimeIds = new Set<string>();

            for (const profile of payload.emulatorProfiles) {
                const profileKey = normalizeDeviceName(profile.name);
                const runtime = runtimeByEmulatorProfile.get(profileKey);
                if (runtime) {
                    usedRuntimeIds.add(runtime.id);
                }

                const connected = runtime
                    ? connectedEmulatorsBySerial.get(runtime.serial)
                    : connectedEmulatorsByProfile.get(profileKey);
                if (connected) {
                    usedConnectedEmulatorSerials.add(connected.serial);
                }

                emulatorOptions.push({
                    id: `emulator-profile:${profile.name}`,
                    selector: { mode: 'emulator-profile', emulatorProfileName: profile.name },
                    label: profile.displayName || profile.name,
                    detail: joinAndroidDeviceDetail([
                        connected?.serial ?? runtime?.serial,
                        buildAndroidVersionDetail(connected?.androidVersion, connected?.apiLevel ?? profile.apiLevel),
                    ]) || (profile.apiLevel !== null ? `API ${profile.apiLevel}` : profile.name),
                    statusKey: runtime
                        ? getRuntimeStatusKey(runtime, projectId)
                        : connected
                            ? getInventoryOnlyStatusKey(connected)
                            : 'device.notRunning',
                    statusColorClass: runtime
                        ? getRuntimeStatusColorClass(runtime)
                        : connected
                            ? getInventoryOnlyStatusColorClass(connected)
                            : 'bg-gray-100 text-gray-600',
                    group: 'emulator',
                });
            }

            for (const connected of payload.connectedDevices) {
                if (connected.kind !== 'emulator' || usedConnectedEmulatorSerials.has(connected.serial)) {
                    continue;
                }
                if (!connected.emulatorProfileName) {
                    continue;
                }
                const runtime = runtimeBySerial.get(connected.serial);
                if (runtime) {
                    usedRuntimeIds.add(runtime.id);
                }
                emulatorOptions.push({
                    id: `emulator-connected:${connected.serial}`,
                    selector: { mode: 'connected-device', serial: connected.serial },
                    label: buildAndroidDeviceOptionLabel(connected),
                    detail: buildAndroidDeviceOptionDetail(connected),
                    statusKey: runtime ? getRuntimeStatusKey(runtime, projectId) : getInventoryOnlyStatusKey(connected),
                    statusColorClass: runtime ? getRuntimeStatusColorClass(runtime) : getInventoryOnlyStatusColorClass(connected),
                    disabled: connected.adbState !== 'device',
                    group: 'emulator',
                });
            }

            for (const runtime of payload.devices) {
                if (runtime.kind !== 'emulator') continue;
                if (usedRuntimeIds.has(runtime.id)) continue;
                emulatorOptions.push({
                    id: `emulator-runtime:${runtime.id}`,
                    selector: runtime.emulatorProfileName
                        ? { mode: 'emulator-profile', emulatorProfileName: runtime.emulatorProfileName }
                        : { mode: 'connected-device', serial: runtime.serial },
                    label: runtime.emulatorProfileName || runtime.serial,
                    detail: runtime.serial,
                    statusKey: getRuntimeStatusKey(runtime, projectId),
                    statusColorClass: getRuntimeStatusColorClass(runtime),
                    group: 'emulator',
                });
            }

            setAndroidDeviceOptions([...physicalOptions, ...emulatorOptions]);
        };

        void fetchDeviceInventory().catch(() => {});
    }, [projectId, getAccessToken, readOnly]);

    return androidDeviceOptions;
}
