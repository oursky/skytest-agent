import { isAndroidRuntimeAvailable } from './android-sdk';

export interface UserFeatures {
    androidRuntimeAvailable: boolean;
    androidAvailable: boolean;
}

export function getUserFeatures(): UserFeatures {
    const androidRuntimeAvailable = isAndroidRuntimeAvailable();

    return {
        androidRuntimeAvailable,
        androidAvailable: androidRuntimeAvailable,
    };
}

export type AndroidAccessStatus = 'enabled' | 'runtime-unavailable';

export function getAndroidAccessStatus(): AndroidAccessStatus {
    if (!isAndroidRuntimeAvailable()) {
        return 'runtime-unavailable';
    }
    return 'enabled';
}

export function isAndroidAvailable(): boolean {
    return isAndroidRuntimeAvailable();
}
