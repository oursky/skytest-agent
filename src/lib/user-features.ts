import { prisma } from '@/lib/prisma';
import { isAndroidRuntimeAvailable } from './android-sdk';

export interface UserFeatures {
    androidEnabled: boolean;
    androidRuntimeAvailable: boolean;
    androidAvailable: boolean;
}

export async function getUserFeatures(userId: string): Promise<UserFeatures> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { androidEnabled: true },
    });

    const androidEnabled = user?.androidEnabled ?? false;
    const androidRuntimeAvailable = isAndroidRuntimeAvailable();

    return {
        androidEnabled,
        androidRuntimeAvailable,
        androidAvailable: androidEnabled && androidRuntimeAvailable,
    };
}

export async function isAndroidEnabledForUser(userId: string): Promise<boolean> {
    const features = await getUserFeatures(userId);
    return features.androidEnabled;
}

export type AndroidAccessStatus = 'enabled' | 'user-disabled' | 'runtime-unavailable';

export async function getAndroidAccessStatusForUser(userId: string): Promise<AndroidAccessStatus> {
    const features = await getUserFeatures(userId);
    if (!features.androidEnabled) {
        return 'user-disabled';
    }
    if (!features.androidRuntimeAvailable) {
        return 'runtime-unavailable';
    }
    return 'enabled';
}

export async function isAndroidAvailableForUser(userId: string): Promise<boolean> {
    const features = await getUserFeatures(userId);
    return features.androidAvailable;
}
