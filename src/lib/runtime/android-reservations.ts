import { normalizeAndroidTargetConfig } from '@/lib/android/target-config';
import type { AndroidDeviceSelector, RunTestOptions } from '@/types';

export interface AndroidAcquireProbeRequest {
    projectId: string;
    selector: AndroidDeviceSelector;
    resourceKey: string;
}

export function getAndroidAcquireProbeRequests(config: RunTestOptions['config']): AndroidAcquireProbeRequest[] {
    if (!config.projectId || !config.browserConfig) {
        return [];
    }

    const requests: AndroidAcquireProbeRequest[] = [];
    for (const target of Object.values(config.browserConfig)) {
        if (!('type' in target) || target.type !== 'android') {
            continue;
        }

        const normalizedTarget = normalizeAndroidTargetConfig(target);
        const selector = normalizedTarget.deviceSelector;
        if (
            (selector.mode === 'emulator-profile' && !selector.emulatorProfileName)
            || (selector.mode === 'connected-device' && !selector.serial)
        ) {
            continue;
        }

        const resourceKey = selector.mode === 'connected-device'
            ? `connected-device:${selector.serial}`
            : `emulator-profile:${selector.emulatorProfileName}`;
        requests.push({
            projectId: config.projectId,
            selector,
            resourceKey,
        });
    }

    return requests;
}

export function getEmulatorProfileNames(config: RunTestOptions['config']): Set<string> {
    const profileNames = new Set<string>();
    if (!config.browserConfig) {
        return profileNames;
    }

    for (const target of Object.values(config.browserConfig)) {
        if (!('type' in target) || target.type !== 'android') {
            continue;
        }
        const normalizedTarget = normalizeAndroidTargetConfig(target);
        const selector = normalizedTarget.deviceSelector;
        if (selector.mode === 'emulator-profile' && selector.emulatorProfileName) {
            profileNames.add(selector.emulatorProfileName);
        }
    }

    return profileNames;
}
