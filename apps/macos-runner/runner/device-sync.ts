import { formatAndroidDeviceDisplayName, type ConnectedAndroidDeviceInfo } from '../../web/src/lib/android/device-display';
type ListAndroidDeviceInventoryFn = typeof import('../../web/src/lib/android/devices').listAndroidDeviceInventory;

type AndroidInventory = Awaited<ReturnType<ListAndroidDeviceInventoryFn>>;

const EMULATOR_PROFILE_DEVICE_PREFIX = 'emulator-profile:';

function mapDeviceState(device: ConnectedAndroidDeviceInfo): 'ONLINE' | 'OFFLINE' | 'UNAVAILABLE' {
    if (device.adbState === 'device') {
        return 'ONLINE';
    }
    if (device.adbState === 'offline') {
        return 'OFFLINE';
    }
    return 'UNAVAILABLE';
}

function buildEmulatorProfileDeviceId(profileName: string): string {
    return `${EMULATOR_PROFILE_DEVICE_PREFIX}${profileName}`;
}

export function buildDeviceSyncPayload(
    inventory: AndroidInventory
) {
    const emulatorDevicesByProfile = new Map(
        inventory.connectedDevices
            .filter((device) => device.kind === 'emulator' && typeof device.emulatorProfileName === 'string' && device.emulatorProfileName.trim().length > 0)
            .map((device) => [device.emulatorProfileName as string, device] as const)
    );

    const connectedDevices = inventory.connectedDevices
        .filter((device) => {
            if (device.kind !== 'emulator') {
                return true;
            }
            if (typeof device.emulatorProfileName !== 'string') {
                return true;
            }
            return device.emulatorProfileName.trim().length === 0;
        })
        .map((device) => ({
            deviceId: device.serial,
            platform: 'ANDROID' as const,
            name: formatAndroidDeviceDisplayName(device),
            state: mapDeviceState(device),
            metadata: {
                inventoryKind: 'connected-device',
                adbState: device.adbState,
                kind: device.kind,
                manufacturer: device.manufacturer,
                model: device.model,
                androidVersion: device.androidVersion,
                apiLevel: device.apiLevel,
                emulatorProfileName: device.emulatorProfileName,
                adbProduct: device.adbProduct,
                adbModel: device.adbModel,
                adbDevice: device.adbDevice,
                transportId: device.transportId,
                usb: device.usb,
            },
        }));

    const emulatorProfiles = inventory.emulatorProfiles
        .map((profile) => {
            const connected = emulatorDevicesByProfile.get(profile.name);
            const state = connected ? mapDeviceState(connected) : 'OFFLINE';

            return {
                deviceId: buildEmulatorProfileDeviceId(profile.name),
                platform: 'ANDROID' as const,
                name: profile.displayName,
                state,
                metadata: {
                    inventoryKind: 'emulator-profile',
                    emulatorProfileName: profile.name,
                    apiLevel: profile.apiLevel,
                    screenSize: profile.screenSize,
                    connectedSerial: connected?.serial ?? null,
                    adbState: connected?.adbState ?? null,
                    manufacturer: connected?.manufacturer ?? null,
                    model: connected?.model ?? null,
                    androidVersion: connected?.androidVersion ?? null,
                },
            };
        });

    return [...connectedDevices, ...emulatorProfiles];
}
