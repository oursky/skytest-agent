import type { AndroidDevicePoolStatusItem } from '@/lib/android-device-manager';

type DeviceState = AndroidDevicePoolStatusItem['state'];

export const DEVICE_STATE_COLORS: Record<DeviceState, string> = {
    STARTING: 'bg-gray-100 text-gray-600',
    BOOTING:  'bg-yellow-100 text-yellow-800',
    IDLE:     'bg-green-100 text-green-800',
    ACQUIRED: 'bg-blue-100 text-blue-800',
    CLEANING: 'bg-orange-100 text-orange-800',
    STOPPING: 'bg-red-100 text-red-800',
    DEAD:     'bg-gray-100 text-gray-500',
};
