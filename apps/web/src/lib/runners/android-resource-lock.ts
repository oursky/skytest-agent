import { RUN_IN_PROGRESS_STATUSES } from '@/types';

export const EMULATOR_PROFILE_DEVICE_PREFIX = 'emulator-profile:';
export const CONNECTED_DEVICE_RESOURCE_PREFIX = 'connected-device:';
export const ACTIVE_LOCKED_RUN_STATUSES = RUN_IN_PROGRESS_STATUSES;

export type AndroidResourceType = 'EMULATOR_PROFILE' | 'CONNECTED_DEVICE';

export function isEmulatorProfileDeviceId(deviceId: string): boolean {
    return deviceId.startsWith(EMULATOR_PROFILE_DEVICE_PREFIX);
}

export function buildHostResourceKey(deviceId: string): string {
    if (isEmulatorProfileDeviceId(deviceId)) {
        return deviceId;
    }
    return `${CONNECTED_DEVICE_RESOURCE_PREFIX}${deviceId}`;
}

export function resolveAndroidResourceType(deviceId: string): AndroidResourceType {
    return isEmulatorProfileDeviceId(deviceId) ? 'EMULATOR_PROFILE' : 'CONNECTED_DEVICE';
}
