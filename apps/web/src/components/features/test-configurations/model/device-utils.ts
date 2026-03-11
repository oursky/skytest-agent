import type { AndroidDeviceSelector } from '@/types';

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
