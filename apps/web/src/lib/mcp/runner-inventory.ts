import { prisma } from '@/lib/core/prisma';
import { getTeamDevicesAvailability, getTeamRunnersOverview } from '@/lib/runners/availability-service';

const EMULATOR_PROFILE_DEVICE_PREFIX = 'emulator-profile:';

interface DeviceMetadata {
    kind?: string;
    manufacturer?: string;
    model?: string;
    emulatorProfileName?: string;
    emulatorProfileDisplayName?: string;
    inventoryKind?: string;
}

function readMetadataString(metadata: Record<string, unknown> | null, key: keyof DeviceMetadata): string | null {
    if (!metadata) {
        return null;
    }
    const value = metadata[key];
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeDeviceLookupValue(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildConnectedDeviceLabel(device: {
    serial: string;
    kind: 'emulator' | 'physical';
    manufacturer?: string;
    model?: string;
    emulatorProfileName?: string;
}): string {
    if (device.kind === 'emulator') {
        return device.emulatorProfileName || device.model || device.serial;
    }

    return [device.manufacturer, device.model].filter(Boolean).join(' ').trim() || device.serial;
}

function parseEmulatorProfileName(deviceId: string, metadata: Record<string, unknown> | null, fallbackName: string): string | null {
    const byMetadata = readMetadataString(metadata, 'emulatorProfileName');
    if (byMetadata) {
        return byMetadata;
    }

    if (deviceId.startsWith(EMULATOR_PROFILE_DEVICE_PREFIX)) {
        const suffix = deviceId.slice(EMULATOR_PROFILE_DEVICE_PREFIX.length).trim();
        return suffix || null;
    }

    return fallbackName.trim() || null;
}

function parseEmulatorProfileDisplayName(profileName: string, metadata: Record<string, unknown> | null): string {
    return readMetadataString(metadata, 'emulatorProfileDisplayName')
        || profileName;
}

export interface ProjectRunnerInventory {
    projectId: string;
    teamId: string;
    refreshedAt: string;
    runnerConnected: boolean;
    runners: Array<{
        id: string;
        label: string;
        kind: string;
        status: string;
        protocolVersion: string;
        runnerVersion: string;
        lastSeenAt: string;
        isFresh: boolean;
        deviceCount: number;
        availableDeviceCount: number;
    }>;
    devices: Array<{
        id: string;
        runnerId: string;
        runnerLabel: string;
        deviceId: string;
        name: string;
        platform: string;
        state: string;
        metadata: Record<string, unknown> | null;
        lastSeenAt: string;
        isFresh: boolean;
        isAvailable: boolean;
    }>;
    androidSelectors: {
        connectedDevices: Array<{
            serial: string;
            kind: 'emulator' | 'physical';
            label: string;
            manufacturer?: string;
            model?: string;
            emulatorProfileName?: string;
            state: string;
            isAvailable: boolean;
            isFresh: boolean;
            runnerId: string;
            runnerLabel: string;
            selector: {
                mode: 'connected-device';
                serial: string;
            };
        }>;
        emulatorProfiles: Array<{
            name: string;
            displayName: string;
            label: string;
            state: string;
            isAvailable: boolean;
            isFresh: boolean;
            runnerId: string;
            runnerLabel: string;
            selector: {
                mode: 'emulator-profile';
                emulatorProfileName: string;
            };
        }>;
    };
}

export async function getProjectRunnerInventory(projectId: string): Promise<ProjectRunnerInventory | null> {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { teamId: true },
    });

    if (!project) {
        return null;
    }

    const [devicesAvailability, runnersOverview] = await Promise.all([
        getTeamDevicesAvailability(project.teamId),
        getTeamRunnersOverview(project.teamId),
    ]);

    const connectedDevices = devicesAvailability.devices
        .filter((device) => device.platform === 'ANDROID')
        .filter((device) => !device.deviceId.startsWith(EMULATOR_PROFILE_DEVICE_PREFIX))
        .map((device) => {
            const metadata = device.metadata;
            const kind = readMetadataString(metadata, 'kind') === 'emulator' ? 'emulator' as const : 'physical' as const;
            const manufacturer = readMetadataString(metadata, 'manufacturer') || undefined;
            const model = readMetadataString(metadata, 'model') || device.name || undefined;
            const emulatorProfileName = readMetadataString(metadata, 'emulatorProfileName') || undefined;
            const serial = device.deviceId;
            const label = buildConnectedDeviceLabel({
                serial,
                kind,
                manufacturer,
                model,
                emulatorProfileName,
            });

            return {
                serial,
                kind,
                label,
                manufacturer,
                model,
                emulatorProfileName,
                state: device.state,
                isAvailable: device.isAvailable,
                isFresh: device.isFresh,
                runnerId: device.runnerId,
                runnerLabel: device.runnerLabel,
                selector: {
                    mode: 'connected-device' as const,
                    serial,
                },
            };
        })
        .sort((a, b) => a.label.localeCompare(b.label));

    const emulatorProfileByName = new Map<string, ProjectRunnerInventory['androidSelectors']['emulatorProfiles'][number]>();
    for (const device of devicesAvailability.devices.filter((row) => row.platform === 'ANDROID')) {
        const metadata = device.metadata;
        const inventoryKind = readMetadataString(metadata, 'inventoryKind');
        if (!device.deviceId.startsWith(EMULATOR_PROFILE_DEVICE_PREFIX) && inventoryKind !== 'emulator-profile') {
            continue;
        }

        const profileName = parseEmulatorProfileName(device.deviceId, metadata, device.name);
        if (!profileName) {
            continue;
        }
        const displayName = parseEmulatorProfileDisplayName(profileName, metadata);
        const label = displayName || profileName;
        const existing = emulatorProfileByName.get(profileName);
        if (!existing) {
            emulatorProfileByName.set(profileName, {
                name: profileName,
                displayName,
                label,
                state: device.state,
                isAvailable: device.isAvailable,
                isFresh: device.isFresh,
                runnerId: device.runnerId,
                runnerLabel: device.runnerLabel,
                selector: {
                    mode: 'emulator-profile',
                    emulatorProfileName: profileName,
                },
            });
            continue;
        }

        if (!existing.isAvailable && device.isAvailable) {
            existing.isAvailable = true;
        }
        if (!existing.isFresh && device.isFresh) {
            existing.isFresh = true;
        }
    }

    const emulatorProfiles = Array.from(emulatorProfileByName.values())
        .sort((a, b) => normalizeDeviceLookupValue(a.label).localeCompare(normalizeDeviceLookupValue(b.label)));

    return {
        projectId,
        teamId: project.teamId,
        refreshedAt: devicesAvailability.refreshedAt,
        runnerConnected: runnersOverview.runnerConnected,
        runners: runnersOverview.runners,
        devices: devicesAvailability.devices,
        androidSelectors: {
            connectedDevices,
            emulatorProfiles,
        },
    };
}
