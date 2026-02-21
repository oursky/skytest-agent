import { execFile } from 'node:child_process';
import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/logger';

const logger = createLogger('android-profiles');

export interface AvailableAndroidProfile {
    id: string;
    name: string;
    displayName: string;
    apiLevel: number | null;
    screenSize: string | null;
    dockerImage: string | null;
}

interface DockerProfileInput {
    name: string;
    displayName?: string;
    dockerImage: string;
    apiLevel?: number;
    screenSize?: string;
}

function execFileAsync(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(file, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve({ stdout: String(stdout), stderr: String(stderr) });
        });
    });
}

function parseDockerProfiles(raw: string): AvailableAndroidProfile[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        logger.warn('Failed to parse EMULATOR_DOCKER_PROFILES', error);
        return [];
    }

    if (!Array.isArray(parsed)) {
        logger.warn('EMULATOR_DOCKER_PROFILES must be a JSON array');
        return [];
    }

    const profiles: AvailableAndroidProfile[] = [];

    for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const candidate = item as Partial<DockerProfileInput>;
        if (typeof candidate.name !== 'string' || candidate.name.trim() === '') continue;
        if (typeof candidate.dockerImage !== 'string' || candidate.dockerImage.trim() === '') continue;

        const name = candidate.name.trim();
        profiles.push({
            id: name,
            name,
            displayName: typeof candidate.displayName === 'string' && candidate.displayName.trim() !== ''
                ? candidate.displayName.trim()
                : name,
            apiLevel: typeof candidate.apiLevel === 'number' ? candidate.apiLevel : null,
            screenSize: typeof candidate.screenSize === 'string' && candidate.screenSize.trim() !== ''
                ? candidate.screenSize.trim()
                : null,
            dockerImage: candidate.dockerImage.trim(),
        });
    }

    return profiles.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function listNativeAvdProfiles(): Promise<AvailableAndroidProfile[]> {
    const { stdout } = await execFileAsync('emulator', ['-list-avds']);
    const names = stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    return names.map((name) => ({
        id: name,
        name,
        displayName: name,
        apiLevel: null,
        screenSize: null,
        dockerImage: null,
    }));
}

export async function listAvailableAndroidProfiles(): Promise<AvailableAndroidProfile[]> {
    if (appConfig.emulator.docker.enabled) {
        return parseDockerProfiles(appConfig.emulator.docker.profilesJson);
    }

    try {
        return await listNativeAvdProfiles();
    } catch (error) {
        logger.warn('Failed to list native AVD profiles', error);
        return [];
    }
}

export async function getAvailableAndroidProfile(name: string): Promise<AvailableAndroidProfile | null> {
    const profiles = await listAvailableAndroidProfiles();
    return profiles.find(profile => profile.name === name) ?? null;
}
