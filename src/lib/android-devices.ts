import { execFile } from 'node:child_process';
import type { AvailableAndroidProfile } from '@/lib/android-profiles';
import { listAvailableAndroidProfiles } from '@/lib/android-profiles';
import { createLogger } from '@/lib/logger';
import { resolveAndroidToolPath } from '@/lib/android-sdk';

const logger = createLogger('android-devices');

export type AdbDeviceState = 'device' | 'offline' | 'unauthorized' | 'unknown';
export type AndroidDeviceKind = 'emulator' | 'physical';

export interface ConnectedAndroidDeviceInfo {
    serial: string;
    adbState: AdbDeviceState;
    kind: AndroidDeviceKind;
    manufacturer: string | null;
    model: string | null;
    androidVersion: string | null;
    apiLevel: number | null;
    emulatorProfileName: string | null;
    adbProduct: string | null;
    adbModel: string | null;
    adbDevice: string | null;
    transportId: string | null;
    usb: string | null;
}

export interface AndroidDeviceInventory {
    connectedDevices: ConnectedAndroidDeviceInfo[];
    emulatorProfiles: AvailableAndroidProfile[];
}

type ParsedAdbListRow = {
    serial: string;
    adbState: AdbDeviceState;
    fields: Map<string, string>;
};

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

function normalizeAdbState(value: string | undefined): AdbDeviceState {
    const state = (value ?? '').trim().toLowerCase();
    if (state === 'device') return 'device';
    if (state === 'offline') return 'offline';
    if (state === 'unauthorized') return 'unauthorized';
    return 'unknown';
}

function parseAdbDevicesLongOutput(stdout: string): ParsedAdbListRow[] {
    const rows: ParsedAdbListRow[] = [];

    for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('List of devices attached')) {
            continue;
        }

        const parts = line.split(/\s+/).filter(Boolean);
        if (parts.length < 2) {
            continue;
        }

        const [serial, rawState, ...extraParts] = parts;
        const fields = new Map<string, string>();

        for (const part of extraParts) {
            const separatorIndex = part.indexOf(':');
            if (separatorIndex <= 0) {
                continue;
            }
            const key = part.slice(0, separatorIndex);
            const value = part.slice(separatorIndex + 1);
            if (key && value) {
                fields.set(key, value);
            }
        }

        rows.push({
            serial,
            adbState: normalizeAdbState(rawState),
            fields,
        });
    }

    return rows;
}

function parseNumber(value: string | null): number | null {
    if (!value) {
        return null;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function prettifyAdbModel(value: string | null): string | null {
    if (!value) {
        return null;
    }
    return value.replace(/_/g, ' ').trim() || null;
}

async function adbShellGetProp(adbPath: string, serial: string, prop: string): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', 'getprop', prop]);
        const value = stdout.trim();
        return value.length > 0 ? value : null;
    } catch {
        return null;
    }
}

async function adbEmulatorAvdName(adbPath: string, serial: string): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'emu', 'avd', 'name']);
        const lines = stdout
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => line.toUpperCase() !== 'OK');
        return lines[0] ?? null;
    } catch {
        return null;
    }
}

async function enrichConnectedDevice(adbPath: string, row: ParsedAdbListRow): Promise<ConnectedAndroidDeviceInfo> {
    const kind: AndroidDeviceKind = row.serial.startsWith('emulator-') ? 'emulator' : 'physical';

    const base: ConnectedAndroidDeviceInfo = {
        serial: row.serial,
        adbState: row.adbState,
        kind,
        manufacturer: null,
        model: prettifyAdbModel(row.fields.get('model') ?? null),
        androidVersion: null,
        apiLevel: null,
        emulatorProfileName: null,
        adbProduct: row.fields.get('product') ?? null,
        adbModel: row.fields.get('model') ?? null,
        adbDevice: row.fields.get('device') ?? null,
        transportId: row.fields.get('transport_id') ?? null,
        usb: row.fields.get('usb') ?? null,
    };

    if (row.adbState !== 'device') {
        return base;
    }

    const manufacturer = await adbShellGetProp(adbPath, row.serial, 'ro.product.manufacturer');
    const model = await adbShellGetProp(adbPath, row.serial, 'ro.product.model');
    const androidVersion = await adbShellGetProp(adbPath, row.serial, 'ro.build.version.release');
    const apiLevelRaw = await adbShellGetProp(adbPath, row.serial, 'ro.build.version.sdk');

    let emulatorProfileName: string | null = null;
    if (kind === 'emulator') {
        emulatorProfileName = await adbEmulatorAvdName(adbPath, row.serial);
    }

    return {
        ...base,
        manufacturer,
        model: model ?? base.model,
        androidVersion,
        apiLevel: parseNumber(apiLevelRaw),
        emulatorProfileName,
    };
}

export async function listConnectedAndroidDevices(): Promise<ConnectedAndroidDeviceInfo[]> {
    const adbPath = resolveAndroidToolPath('adb');

    try {
        const { stdout } = await execFileAsync(adbPath, ['devices', '-l']);
        const rows = parseAdbDevicesLongOutput(stdout);
        const devices: ConnectedAndroidDeviceInfo[] = [];

        for (const row of rows) {
            devices.push(await enrichConnectedDevice(adbPath, row));
        }

        return devices;
    } catch (error) {
        logger.warn('Failed to list connected Android devices via ADB', error);
        return [];
    }
}

export async function listAndroidDeviceInventory(): Promise<AndroidDeviceInventory> {
    const [connectedDevices, emulatorProfiles] = await Promise.all([
        listConnectedAndroidDevices(),
        listAvailableAndroidProfiles(),
    ]);

    return {
        connectedDevices,
        emulatorProfiles,
    };
}

export function formatAndroidDeviceDisplayName(device: Pick<ConnectedAndroidDeviceInfo, 'kind' | 'manufacturer' | 'model' | 'emulatorProfileName' | 'serial'>): string {
    if (device.kind === 'emulator') {
        return device.emulatorProfileName ?? device.model ?? device.serial;
    }

    const manufacturer = (device.manufacturer ?? '').trim();
    const model = (device.model ?? '').trim();
    const combined = [manufacturer, model].filter(Boolean).join(' ').trim();
    return combined || device.serial;
}
