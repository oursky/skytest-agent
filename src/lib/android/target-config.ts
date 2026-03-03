import type { AndroidTargetConfig, AndroidDeviceSelector } from '@/types';

export interface NormalizedAndroidTargetConfig extends Omit<AndroidTargetConfig, 'deviceSelector'> {
    deviceSelector: AndroidDeviceSelector;
}

export function normalizeAndroidTargetConfig(config: AndroidTargetConfig): NormalizedAndroidTargetConfig {
    return {
        ...config,
        deviceSelector: normalizeAndroidDeviceSelector(config.deviceSelector),
    };
}

export function normalizeAndroidDeviceSelector(selector: AndroidDeviceSelector): AndroidDeviceSelector {
    if (selector.mode === 'connected-device') {
        return {
            mode: 'connected-device',
            serial: selector.serial.trim(),
        };
    }

    return {
        mode: 'emulator-profile',
        emulatorProfileName: selector.emulatorProfileName.trim(),
    };
}

export function getAndroidDeviceSelectorResourceKey(selector: AndroidDeviceSelector): string {
    if (selector.mode === 'connected-device') {
        return `connected-device:${selector.serial}`;
    }
    return `emulator-profile:${selector.emulatorProfileName}`;
}
