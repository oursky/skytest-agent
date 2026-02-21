import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from './logger';
import { getAndroidSdkSetupHint, resolveAndroidToolPath } from './android-sdk';

export interface AvailableAndroidProfile {
    id: string;
    name: string;
    displayName: string;
    apiLevel: number | null;
    screenSize: string | null;
}

const logger = createLogger('android-profiles');

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

function formatDisplayName(name: string): string {
    const spaced = name.replace(/[_-]+/g, ' ').trim();
    if (!spaced) {
        return name;
    }
    return spaced.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function parseApiLevelFromSysDir(value: string | undefined): number | null {
    if (!value) {
        return null;
    }
    const match = value.match(/android-(\d+)/i);
    if (!match) {
        return null;
    }
    const level = Number.parseInt(match[1], 10);
    return Number.isFinite(level) ? level : null;
}

function parseNumber(value: string | undefined): number | null {
    if (!value) {
        return null;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function readAvdConfig(avdName: string): { apiLevel: number | null; screenSize: string | null } {
    const avdConfigPath = path.join(os.homedir(), '.android', 'avd', `${avdName}.avd`, 'config.ini');
    if (!existsSync(avdConfigPath)) {
        return { apiLevel: null, screenSize: null };
    }

    const raw = readFileSync(avdConfigPath, 'utf8');
    const values = new Map<string, string>();
    for (const line of raw.split('\n')) {
        const normalized = line.trim();
        if (!normalized || normalized.startsWith('#')) {
            continue;
        }
        const separatorIndex = normalized.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }
        const key = normalized.slice(0, separatorIndex).trim();
        const value = normalized.slice(separatorIndex + 1).trim();
        values.set(key, value);
    }

    const apiLevel = parseApiLevelFromSysDir(values.get('image.sysdir.1'));
    const width = parseNumber(values.get('hw.lcd.width'));
    const height = parseNumber(values.get('hw.lcd.height'));
    const screenSize = width && height ? `${width}x${height}` : null;

    return { apiLevel, screenSize };
}

export async function listAvailableAndroidProfiles(): Promise<AvailableAndroidProfile[]> {
    const emulatorPath = resolveAndroidToolPath('emulator');
    try {
        const { stdout } = await execFileAsync(emulatorPath, ['-list-avds']);
        const avdNames = stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        return avdNames
            .map((name) => {
                const config = readAvdConfig(name);
                return {
                    id: name,
                    name,
                    displayName: formatDisplayName(name),
                    apiLevel: config.apiLevel,
                    screenSize: config.screenSize,
                };
            })
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
    } catch (error) {
        logger.warn(`Failed to list local AVD profiles: ${getAndroidSdkSetupHint()}`, error);
        return [];
    }
}

export async function getAvailableAndroidProfile(name: string): Promise<AvailableAndroidProfile | null> {
    const profiles = await listAvailableAndroidProfiles();
    return profiles.find(profile => profile.name === name) ?? null;
}
