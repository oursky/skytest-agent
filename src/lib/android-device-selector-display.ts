import type { AndroidDeviceSelector } from '@/types';
import { normalizeAndroidDeviceSelector } from '@/lib/android-target-config';

export interface AndroidDeviceSelectorDisplay {
    label: string;
    detail: string;
    rawValue: string;
}

export function formatAndroidDeviceSelectorRawValue(selector: AndroidDeviceSelector): string {
    const normalized = normalizeAndroidDeviceSelector(selector);
    if (normalized.mode === 'connected-device') {
        return `serial:${normalized.serial}`;
    }
    return normalized.emulatorProfileName;
}

export function formatAndroidDeviceSelectorDisplay(selector: AndroidDeviceSelector): AndroidDeviceSelectorDisplay {
    const normalized = normalizeAndroidDeviceSelector(selector);

    if (normalized.mode === 'connected-device') {
        return {
            label: normalized.serial,
            detail: 'Connected device',
            rawValue: `serial:${normalized.serial}`,
        };
    }

    return {
        label: normalized.emulatorProfileName,
        detail: 'Emulator profile',
        rawValue: normalized.emulatorProfileName,
    };
}
