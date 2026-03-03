export type AdbDeviceState = 'device' | 'offline' | 'unauthorized' | 'unknown';
export type AndroidDeviceKind = 'emulator' | 'physical';

export interface ConnectedAndroidDeviceInfo {
    serial: string;
    adbState: AdbDeviceState;
    kind: AndroidDeviceKind;
    manufacturer: string | null;
    model: string | null;
    androidVersion: string | null;
    apiLevel: number | null;
    emulatorProfileName: string | null;
    adbProduct: string | null;
    adbModel: string | null;
    adbDevice: string | null;
    transportId: string | null;
    usb: string | null;
}

export function formatAndroidDeviceDisplayName(
    device: Pick<ConnectedAndroidDeviceInfo, 'kind' | 'manufacturer' | 'model' | 'emulatorProfileName' | 'serial'>
): string {
    if (device.kind === 'emulator') {
        return device.emulatorProfileName ?? device.model ?? device.serial;
    }

    const manufacturer = (device.manufacturer ?? '').trim();
    const model = (device.model ?? '').trim();
    const combined = [manufacturer, model].filter(Boolean).join(' ').trim();
    return combined || device.serial;
}
