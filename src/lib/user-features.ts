import { prisma } from '@/lib/prisma';

export interface UserFeatures {
    androidEnabled: boolean;
}

export async function getUserFeatures(userId: string): Promise<UserFeatures> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { androidEnabled: true },
    });

    return {
        androidEnabled: user?.androidEnabled ?? false,
    };
}

export async function isAndroidEnabledForUser(userId: string): Promise<boolean> {
    const features = await getUserFeatures(userId);
    return features.androidEnabled;
}
