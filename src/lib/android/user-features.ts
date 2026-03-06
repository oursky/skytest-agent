export interface UserFeatures {
    androidRuntimeAvailable: boolean;
    androidAvailable: boolean;
}

export function getUserFeatures(): UserFeatures {
    return {
        androidRuntimeAvailable: true,
        androidAvailable: true,
    };
}

export type AndroidAccessStatus = 'enabled';

export function getAndroidAccessStatus(): AndroidAccessStatus {
    return 'enabled';
}

export function isAndroidAvailable(): boolean {
    return true;
}
