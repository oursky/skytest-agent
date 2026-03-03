import type { AndroidDevicePoolStatusItem } from '@/lib/android/device-manager';
import type { ConnectedAndroidDeviceInfo } from '@/lib/android/device-display';
import {
    ADB_STATE_PRIORITY,
    DEVICE_STATE_PRIORITY,
    buildAndroidVersionDetail,
    joinAndroidDeviceDetail,
    normalizeDeviceName,
} from '@/components/configurations-section/device-utils';
import { formatAndroidDeviceDisplayName } from '@/lib/android/device-display';
import type { DeviceStatusResponse, EmulatorRow } from './types';

function buildConnectedDeviceTitle(device: ConnectedAndroidDeviceInfo): string {
    return formatAndroidDeviceDisplayName(device);
}

function buildConnectedDeviceDetail(device: ConnectedAndroidDeviceInfo): string {
    return joinAndroidDeviceDetail([
        device.serial,
        buildAndroidVersionDetail(device.androidVersion, device.apiLevel),
    ]) || device.serial;
}

export interface DeviceSections {
    connectedRuntimeBySerial: Map<string, AndroidDevicePoolStatusItem>;
    connectedPhysicalDevices: ConnectedAndroidDeviceInfo[];
    emulatorRows: EmulatorRow[];
    showPhysicalSection: boolean;
    showEmulatorSection: boolean;
}

export function buildDeviceSections(status: DeviceStatusResponse | null): DeviceSections {
    const connectedRuntimeBySerial = new Map<string, AndroidDevicePoolStatusItem>();
    const runtimeByEmulatorProfile = new Map<string, AndroidDevicePoolStatusItem>();
    const connectedPhysicalDevices: ConnectedAndroidDeviceInfo[] = [];
    const connectedEmulatorsBySerial = new Map<string, ConnectedAndroidDeviceInfo>();
    const connectedEmulatorsByProfile = new Map<string, ConnectedAndroidDeviceInfo>();

    if (status) {
        for (const device of status.devices) {
            connectedRuntimeBySerial.set(device.serial, device);
            if (device.kind === 'emulator' && device.emulatorProfileName) {
                const normalizedProfileName = normalizeDeviceName(device.emulatorProfileName);
                const existing = runtimeByEmulatorProfile.get(normalizedProfileName);
                if (!existing || DEVICE_STATE_PRIORITY[device.state] < DEVICE_STATE_PRIORITY[existing.state]) {
                    runtimeByEmulatorProfile.set(normalizedProfileName, device);
                }
            }
        }

        for (const connected of status.connectedDevices) {
            if (connected.kind === 'physical') {
                connectedPhysicalDevices.push(connected);
                continue;
            }

            connectedEmulatorsBySerial.set(connected.serial, connected);
            if (!connected.emulatorProfileName) {
                continue;
            }

            const normalizedProfileName = normalizeDeviceName(connected.emulatorProfileName);
            const existing = connectedEmulatorsByProfile.get(normalizedProfileName);
            if (!existing || ADB_STATE_PRIORITY[connected.adbState] < ADB_STATE_PRIORITY[existing.adbState]) {
                connectedEmulatorsByProfile.set(normalizedProfileName, connected);
            }
        }
    }

    const emulatorRows: EmulatorRow[] = [];

    if (status) {
        const usedConnectedEmulatorSerials = new Set<string>();
        const usedRuntimeIds = new Set<string>();

        for (const profile of status.emulatorProfiles) {
            const runtime = runtimeByEmulatorProfile.get(normalizeDeviceName(profile.name));
            if (runtime) {
                usedRuntimeIds.add(runtime.id);
            }

            const connected = runtime
                ? connectedEmulatorsBySerial.get(runtime.serial)
                : connectedEmulatorsByProfile.get(normalizeDeviceName(profile.name));
            if (connected) {
                usedConnectedEmulatorSerials.add(connected.serial);
            }

            const detail = joinAndroidDeviceDetail([
                connected?.serial ?? runtime?.serial,
                buildAndroidVersionDetail(connected?.androidVersion ?? null, connected?.apiLevel ?? profile.apiLevel),
            ]) || profile.name;

            emulatorRows.push({
                key: `profile:${profile.name}`,
                title: profile.displayName || profile.name,
                detail,
                runtime,
                connected,
                profileName: profile.name,
                canBoot: !runtime && !connected,
            });
        }

        for (const connected of status.connectedDevices) {
            if (connected.kind !== 'emulator' || usedConnectedEmulatorSerials.has(connected.serial)) {
                continue;
            }

            if (!connected.emulatorProfileName) {
                continue;
            }

            if (connected.adbState === 'offline') {
                continue;
            }

            const runtime = connectedRuntimeBySerial.get(connected.serial);
            if (runtime) {
                usedRuntimeIds.add(runtime.id);
            }

            emulatorRows.push({
                key: `connected-emulator:${connected.serial}`,
                title: buildConnectedDeviceTitle(connected),
                detail: buildConnectedDeviceDetail(connected),
                runtime,
                connected,
                canBoot: false,
            });
        }

        for (const runtime of status.devices) {
            if (runtime.kind !== 'emulator' || usedRuntimeIds.has(runtime.id)) {
                continue;
            }

            emulatorRows.push({
                key: `runtime-emulator:${runtime.id}`,
                title: runtime.emulatorProfileName ?? runtime.id,
                detail: runtime.serial,
                runtime,
                canBoot: false,
            });
        }
    }

    return {
        connectedRuntimeBySerial,
        connectedPhysicalDevices,
        emulatorRows,
        showPhysicalSection: connectedPhysicalDevices.length > 0,
        showEmulatorSection: Boolean(status && emulatorRows.length > 0),
    };
}
