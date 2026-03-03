import type { AndroidDeviceSelector } from '@/types';

export interface DeviceInventoryResponse {
    devices: Array<{
        id: string;
        kind: 'emulator' | 'physical';
        serial: string;
        emulatorProfileName?: string;
        state: 'STARTING' | 'BOOTING' | 'IDLE' | 'ACQUIRED' | 'CLEANING' | 'STOPPING' | 'DEAD';
        runProjectId?: string;
    }>;
    connectedDevices: Array<{
        serial: string;
        adbState: 'device' | 'offline' | 'unauthorized' | 'unknown';
        kind: 'emulator' | 'physical';
        manufacturer: string | null;
        model: string | null;
        androidVersion: string | null;
        apiLevel: number | null;
        emulatorProfileName: string | null;
    }>;
    emulatorProfiles: Array<{
        id: string;
        name: string;
        displayName: string;
        apiLevel: number | null;
    }>;
}

export interface AndroidDeviceOption {
    id: string;
    selector: AndroidDeviceSelector;
    label: string;
    detail: string;
    statusKey: string;
    statusColorClass: string;
    disabled?: boolean;
    group: 'physical' | 'emulator';
}

export const DEVICE_STATE_PRIORITY: Record<DeviceInventoryResponse['devices'][number]['state'], number> = {
    ACQUIRED: 0,
    CLEANING: 1,
    IDLE: 2,
    BOOTING: 3,
    STARTING: 4,
    STOPPING: 5,
    DEAD: 6,
};

export const ADB_STATE_PRIORITY: Record<DeviceInventoryResponse['connectedDevices'][number]['adbState'], number> = {
    device: 0,
    unauthorized: 1,
    offline: 2,
    unknown: 3,
};

export function buildAndroidDeviceOptionLabel(option: DeviceInventoryResponse['connectedDevices'][number]): string {
    if (option.kind === 'emulator') {
        return option.emulatorProfileName || option.model || option.serial;
    }
    return [option.manufacturer, option.model].filter(Boolean).join(' ').trim() || option.serial;
}

export function joinAndroidDeviceDetail(parts: Array<string | null | undefined>): string {
    return parts.filter((part): part is string => Boolean(part && part.trim())).join(', ');
}

export function buildAndroidVersionDetail(androidVersion: string | null | undefined, apiLevel: number | null | undefined): string {
    return joinAndroidDeviceDetail([
        androidVersion ? `Android ${androidVersion}` : null,
        apiLevel !== null && apiLevel !== undefined ? `API ${apiLevel}` : null,
    ]);
}

export function buildAndroidDeviceOptionDetail(option: DeviceInventoryResponse['connectedDevices'][number]): string {
    return joinAndroidDeviceDetail([option.serial, buildAndroidVersionDetail(option.androidVersion, option.apiLevel)]) || option.serial;
}

export function getInventoryOnlyStatusKey(option: DeviceInventoryResponse['connectedDevices'][number]): string {
    if (option.adbState === 'device') return 'device.state.idle';
    if (option.adbState === 'unauthorized') return 'device.adb.unauthorized';
    if (option.adbState === 'offline') return 'device.adb.offline';
    return 'device.adb.unknown';
}

export function getInventoryOnlyStatusColorClass(option: DeviceInventoryResponse['connectedDevices'][number]): string {
    if (option.adbState === 'device') return 'bg-green-100 text-green-700';
    if (option.adbState === 'unauthorized') return 'bg-amber-100 text-amber-700';
    return 'bg-gray-100 text-gray-600';
}

export function normalizeDeviceName(name: string): string {
    return name.trim().toLowerCase();
}

function isRuntimeInUseByCurrentProject(
    runtime: DeviceInventoryResponse['devices'][number],
    projectId?: string
): boolean {
    return runtime.state === 'ACQUIRED' && Boolean(projectId && runtime.runProjectId === projectId);
}

export function getRuntimeStatusKey(
    runtime: DeviceInventoryResponse['devices'][number],
    projectId?: string
): string {
    if (runtime.state === 'ACQUIRED') {
        return isRuntimeInUseByCurrentProject(runtime, projectId)
            ? 'device.inUseCurrentProject'
            : 'device.inUseOtherProject';
    }

    if (runtime.state === 'STARTING') return 'device.state.starting';
    if (runtime.state === 'BOOTING') return 'device.state.booting';
    if (runtime.state === 'IDLE') return 'device.state.idle';
    if (runtime.state === 'CLEANING') return 'device.state.cleaning';
    if (runtime.state === 'STOPPING') return 'device.state.stopping';
    return 'device.state.dead';
}

export function getRuntimeStatusColorClass(runtime: DeviceInventoryResponse['devices'][number]): string {
    if (runtime.state === 'STARTING') return 'bg-blue-100 text-blue-700';
    if (runtime.state === 'BOOTING') return 'bg-blue-100 text-blue-700';
    if (runtime.state === 'IDLE') return 'bg-green-100 text-green-700';
    if (runtime.state === 'ACQUIRED') return 'bg-amber-100 text-amber-700';
    if (runtime.state === 'CLEANING') return 'bg-yellow-100 text-yellow-700';
    if (runtime.state === 'STOPPING') return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-600';
}

export function isSameAndroidDeviceSelector(a: AndroidDeviceSelector, b: AndroidDeviceSelector): boolean {
    if (a.mode !== b.mode) {
        return false;
    }
    if (a.mode === 'connected-device') {
        return b.mode === 'connected-device' && a.serial === b.serial;
    }
    return b.mode === 'emulator-profile' && a.emulatorProfileName === b.emulatorProfileName;
}

export function getAndroidDeviceSelectorLabel(selector: AndroidDeviceSelector): string {
    return selector.mode === 'connected-device'
        ? selector.serial
        : selector.emulatorProfileName;
}
