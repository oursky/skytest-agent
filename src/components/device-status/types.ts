import type { AndroidDevicePoolStatus, AndroidDevicePoolStatusItem } from '@/lib/android/device-manager';
import type { ConnectedAndroidDeviceInfo } from '@/lib/android/device-display';

export interface DeviceStatusResponse extends AndroidDevicePoolStatus {
    connectedDevices: ConnectedAndroidDeviceInfo[];
    emulatorProfiles: Array<{
        id: string;
        name: string;
        displayName: string;
        apiLevel: number | null;
        screenSize: string | null;
    }>;
}

export interface EmulatorRow {
    key: string;
    title: string;
    detail: string;
    runtime?: AndroidDevicePoolStatusItem;
    connected?: ConnectedAndroidDeviceInfo;
    profileName?: string;
    canBoot: boolean;
}
