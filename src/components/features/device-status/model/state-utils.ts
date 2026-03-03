import type { AndroidDevicePoolStatusItem } from '@/lib/android/device-manager';
import type { ConnectedAndroidDeviceInfo } from '@/lib/android/device-display';
import { DEVICE_STATE_COLORS } from '@/utils/deviceStateColors';
import { getInventoryOnlyStatusColorClass, getInventoryOnlyStatusKey } from '@/components/features/configurations/model/device-utils';

export const DEVICE_STATE_LABEL_KEYS: Record<Exclude<AndroidDevicePoolStatusItem['state'], 'ACQUIRED'>, string> = {
    STARTING: 'device.state.starting',
    BOOTING: 'device.state.booting',
    IDLE: 'device.state.idle',
    CLEANING: 'device.state.cleaning',
    STOPPING: 'device.state.stopping',
    DEAD: 'device.state.dead',
};

export function isDeviceInUseByCurrentProject(device: AndroidDevicePoolStatusItem, projectId: string): boolean {
    return device.state === 'ACQUIRED' && device.runProjectId === projectId;
}

export function getConnectedDeviceBadge(
    connected: ConnectedAndroidDeviceInfo,
    runtime: AndroidDevicePoolStatusItem | undefined,
    projectId: string
): { key: string; color: string } {
    if (runtime) {
        if (runtime.state === 'ACQUIRED') {
            return {
                key: isDeviceInUseByCurrentProject(runtime, projectId)
                    ? 'device.inUseCurrentProject'
                    : 'device.inUseOtherProject',
                color: DEVICE_STATE_COLORS.ACQUIRED,
            };
        }

        return {
            key: DEVICE_STATE_LABEL_KEYS[runtime.state],
            color: DEVICE_STATE_COLORS[runtime.state],
        };
    }

    return {
        key: getInventoryOnlyStatusKey(connected),
        color: getInventoryOnlyStatusColorClass(connected),
    };
}

export function formatCountdown(remainingMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
