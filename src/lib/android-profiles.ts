import { config as appConfig } from '@/config/app';

export interface AvailableAndroidProfile {
    id: string;
    name: string;
    displayName: string;
    apiLevel: number | null;
    screenSize: string | null;
    dockerImage: string;
}

export async function listAvailableAndroidProfiles(): Promise<AvailableAndroidProfile[]> {
    return appConfig.emulator.docker.profiles
        .map((profile) => ({
            id: profile.name,
            name: profile.name,
            displayName: profile.displayName,
            apiLevel: profile.apiLevel,
            screenSize: profile.screenSize,
            dockerImage: profile.dockerImage,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getAvailableAndroidProfile(name: string): Promise<AvailableAndroidProfile | null> {
    const profiles = await listAvailableAndroidProfiles();
    return profiles.find(profile => profile.name === name) ?? null;
}
