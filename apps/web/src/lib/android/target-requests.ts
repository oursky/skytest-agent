import { normalizeAndroidTargetConfig } from '@/lib/android/target-config';
import { EMULATOR_PROFILE_DEVICE_PREFIX } from '@/lib/runners/android-resource-lock';
import type { AndroidTargetConfig, BrowserConfig, TargetConfig } from '@/types';

type TargetConfigMap = Record<string, BrowserConfig | TargetConfig> | undefined;

export function isAndroidTargetConfig(config: BrowserConfig | TargetConfig): config is AndroidTargetConfig {
    return 'type' in config && config.type === 'android';
}

export function hasAndroidTargets(browserConfig: TargetConfigMap): boolean {
    if (!browserConfig || Object.keys(browserConfig).length === 0) {
        return false;
    }

    return Object.values(browserConfig).some(isAndroidTargetConfig);
}

export function buildEmulatorProfileRequestedDeviceId(profileName: string): string {
    return `${EMULATOR_PROFILE_DEVICE_PREFIX}${profileName}`;
}

export function collectAndroidRequestedDeviceIds(browserConfig: TargetConfigMap): Set<string> {
    const requestedDeviceIds = new Set<string>();
    if (!browserConfig || Object.keys(browserConfig).length === 0) {
        return requestedDeviceIds;
    }

    for (const target of Object.values(browserConfig).filter(isAndroidTargetConfig)) {
        const selector = normalizeAndroidTargetConfig(target).deviceSelector;
        if (selector.mode === 'connected-device' && selector.serial) {
            requestedDeviceIds.add(selector.serial);
            continue;
        }
        if (selector.mode === 'emulator-profile' && selector.emulatorProfileName) {
            requestedDeviceIds.add(buildEmulatorProfileRequestedDeviceId(selector.emulatorProfileName));
        }
    }

    return requestedDeviceIds;
}

export function extractRequestedDeviceId(browserConfig: TargetConfigMap): string | null {
    const requestedDeviceIds = collectAndroidRequestedDeviceIds(browserConfig);
    if (requestedDeviceIds.size !== 1) {
        return null;
    }
    return requestedDeviceIds.values().next().value ?? null;
}

export function collectAndroidRequestedRunnerIds(browserConfig: TargetConfigMap): Set<string> {
    const requestedRunnerIds = new Set<string>();
    if (!browserConfig || Object.keys(browserConfig).length === 0) {
        return requestedRunnerIds;
    }

    for (const target of Object.values(browserConfig).filter(isAndroidTargetConfig)) {
        const runnerId = target.runnerScope?.runnerId;
        if (typeof runnerId === 'string' && runnerId.trim().length > 0) {
            requestedRunnerIds.add(runnerId.trim());
        }
    }

    return requestedRunnerIds;
}

export function extractRequestedRunnerId(browserConfig: TargetConfigMap): string | null {
    const requestedRunnerIds = collectAndroidRequestedRunnerIds(browserConfig);
    if (requestedRunnerIds.size !== 1) {
        return null;
    }
    return requestedRunnerIds.values().next().value ?? null;
}

export function isEmulatorProfileInventoryDevice(device: { deviceId: string; metadata: Record<string, unknown> | null }): boolean {
    return device.deviceId.startsWith(EMULATOR_PROFILE_DEVICE_PREFIX)
        || device.metadata?.inventoryKind === 'emulator-profile';
}
