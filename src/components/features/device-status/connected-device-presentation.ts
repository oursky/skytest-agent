import type { ConnectedAndroidDeviceInfo } from '@/lib/android/device-display';
import { formatAndroidDeviceDisplayName } from '@/lib/android/device-display';
import { buildAndroidVersionDetail, joinAndroidDeviceDetail } from '@/components/features/configurations/model/device-utils';

export function buildConnectedDeviceTitle(device: ConnectedAndroidDeviceInfo): string {
    return formatAndroidDeviceDisplayName(device);
}

export function buildConnectedDeviceDetail(device: ConnectedAndroidDeviceInfo): string {
    return joinAndroidDeviceDetail([
        device.serial,
        buildAndroidVersionDetail(device.androidVersion, device.apiLevel),
    ]) || device.serial;
}
