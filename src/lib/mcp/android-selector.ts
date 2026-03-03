import type { AndroidDeviceSelector } from '@/types';
import type { AndroidDeviceInventory } from '@/lib/android/devices';

export interface AndroidDeviceSelectorInput {
    mode: 'emulator-profile' | 'connected-device';
    emulatorProfileName?: string;
    serial?: string;
}

function normalizeDeviceLookupValue(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildConnectedDeviceLabel(device: AndroidDeviceInventory['connectedDevices'][number]): string {
    if (device.kind === 'emulator') {
        return device.emulatorProfileName || device.model || device.serial;
    }
    return [device.manufacturer, device.model].filter(Boolean).join(' ').trim() || device.serial;
}

function getUniqueProfileName(matches: ReadonlyArray<AndroidDeviceInventory['emulatorProfiles'][number]>): string | null {
    const profileNames = Array.from(new Set(matches.map((profile) => profile.name)));
    return profileNames.length === 1 ? profileNames[0] : null;
}

function resolveEmulatorProfileName(rawDevice: string, inventory: AndroidDeviceInventory): string | null {
    const trimmed = rawDevice.trim();
    if (!trimmed) {
        return null;
    }

    const lower = trimmed.toLowerCase();
    const normalized = normalizeDeviceLookupValue(trimmed);

    const exactByName = inventory.emulatorProfiles.find((profile) => profile.name === trimmed);
    if (exactByName) {
        return exactByName.name;
    }

    const exactByNameIgnoreCase = getUniqueProfileName(
        inventory.emulatorProfiles.filter((profile) => profile.name.toLowerCase() === lower)
    );
    if (exactByNameIgnoreCase) {
        return exactByNameIgnoreCase;
    }

    const exactByDisplayName = getUniqueProfileName(
        inventory.emulatorProfiles.filter((profile) => profile.displayName.toLowerCase() === lower)
    );
    if (exactByDisplayName) {
        return exactByDisplayName;
    }

    const normalizedMatch = getUniqueProfileName(
        inventory.emulatorProfiles.filter((profile) =>
            normalizeDeviceLookupValue(profile.name) === normalized
            || normalizeDeviceLookupValue(profile.displayName) === normalized
        )
    );
    if (normalizedMatch) {
        return normalizedMatch;
    }

    const prefixMatch = getUniqueProfileName(
        inventory.emulatorProfiles.filter((profile) =>
            profile.name.toLowerCase().startsWith(lower)
            || profile.displayName.toLowerCase().startsWith(lower)
        )
    );
    if (prefixMatch) {
        return prefixMatch;
    }

    return null;
}

function resolveConnectedSerial(rawSerial: string, inventory: AndroidDeviceInventory): string | null {
    const serialLookup = rawSerial.trim().toLowerCase();
    if (!serialLookup) {
        return null;
    }
    const matched = inventory.connectedDevices.find((device) => device.serial.toLowerCase() === serialLookup);
    return matched?.serial ?? null;
}

function resolveConnectedDeviceByAlias(rawDevice: string, inventory: AndroidDeviceInventory): string | null {
    const trimmed = rawDevice.trim();
    if (!trimmed) {
        return null;
    }

    const lower = trimmed.toLowerCase();
    const normalized = normalizeDeviceLookupValue(trimmed);

    const exactLabelMatches = inventory.connectedDevices.filter(
        (device) => buildConnectedDeviceLabel(device).toLowerCase() === lower
    );
    const exactLabelSerials = Array.from(new Set(exactLabelMatches.map((device) => device.serial)));
    if (exactLabelSerials.length === 1) {
        return exactLabelSerials[0];
    }

    const normalizedMatches = inventory.connectedDevices.filter(
        (device) => normalizeDeviceLookupValue(buildConnectedDeviceLabel(device)) === normalized
    );
    const normalizedSerials = Array.from(new Set(normalizedMatches.map((device) => device.serial)));
    if (normalizedSerials.length === 1) {
        return normalizedSerials[0];
    }

    const prefixMatches = inventory.connectedDevices.filter(
        (device) => buildConnectedDeviceLabel(device).toLowerCase().startsWith(lower)
    );
    const prefixSerials = Array.from(new Set(prefixMatches.map((device) => device.serial)));
    if (prefixSerials.length === 1) {
        return prefixSerials[0];
    }

    return null;
}

export function resolveAndroidDeviceSelector(
    device?: string,
    selector?: AndroidDeviceSelectorInput,
    inventory?: AndroidDeviceInventory
): AndroidDeviceSelector | null {
    if (selector) {
        if (selector.mode === 'connected-device') {
            const serial = selector.serial?.trim();
            if (serial) {
                const resolvedSerial = inventory ? resolveConnectedSerial(serial, inventory) : null;
                return { mode: 'connected-device', serial: resolvedSerial ?? serial };
            }
            return null;
        }
        const emulatorProfileName = selector.emulatorProfileName?.trim();
        if (emulatorProfileName) {
            const resolvedProfileName = inventory ? resolveEmulatorProfileName(emulatorProfileName, inventory) : null;
            return { mode: 'emulator-profile', emulatorProfileName: resolvedProfileName ?? emulatorProfileName };
        }
        return null;
    }

    const rawDevice = device?.trim();
    if (!rawDevice) {
        return null;
    }
    if (rawDevice.toLowerCase().startsWith('serial:')) {
        const serial = rawDevice.slice('serial:'.length).trim();
        return serial ? { mode: 'connected-device', serial } : null;
    }

    if (inventory) {
        const resolvedSerial = resolveConnectedSerial(rawDevice, inventory);
        if (resolvedSerial) {
            return { mode: 'connected-device', serial: resolvedSerial };
        }

        const resolvedProfileName = resolveEmulatorProfileName(rawDevice, inventory);
        if (resolvedProfileName) {
            return { mode: 'emulator-profile', emulatorProfileName: resolvedProfileName };
        }

        const aliasSerial = resolveConnectedDeviceByAlias(rawDevice, inventory);
        if (aliasSerial) {
            return { mode: 'connected-device', serial: aliasSerial };
        }
    }

    return { mode: 'emulator-profile', emulatorProfileName: rawDevice };
}
