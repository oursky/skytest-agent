import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runnerFindMany } = vi.hoisted(() => ({
    runnerFindMany: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        runner: {
            findMany: runnerFindMany,
        },
    },
}));

const { getTeamDevicesAvailability } = await import('@/lib/runners/availability-service');

describe('getTeamDevicesAvailability', () => {
    beforeEach(() => {
        runnerFindMany.mockReset();
    });

    it('deduplicates connected emulator serial rows when profile rows exist', async () => {
        const now = new Date();

        runnerFindMany.mockResolvedValue([
            {
                id: 'runner-1',
                label: 'Local macOS Runner',
                kind: 'MACOS_AGENT',
                status: 'ONLINE',
                protocolVersion: '1.0.0',
                runnerVersion: '0.1.0',
                lastSeenAt: now,
                devices: [
                    {
                        id: 'device-connected',
                        deviceId: 'emulator-5554',
                        platform: 'ANDROID',
                        name: 'Pixel_8',
                        state: 'ONLINE',
                        metadata: {
                            kind: 'emulator',
                            emulatorProfileName: 'Pixel_8',
                        },
                        lastSeenAt: now,
                    },
                    {
                        id: 'device-profile',
                        deviceId: 'emulator-profile:Pixel_8',
                        platform: 'ANDROID',
                        name: 'Pixel 8',
                        state: 'ONLINE',
                        metadata: {
                            inventoryKind: 'emulator-profile',
                            emulatorProfileName: 'Pixel_8',
                        },
                        lastSeenAt: now,
                    },
                ],
            },
        ]);

        const result = await getTeamDevicesAvailability('team-dedupe-test');

        expect(result.devices).toHaveLength(1);
        expect(result.devices[0]).toMatchObject({
            deviceId: 'emulator-profile:Pixel_8',
            state: 'ONLINE',
        });
        expect(result.availableDeviceCount).toBe(1);
    });

    it('hides connected emulator serial rows even when profile rows are missing', async () => {
        const now = new Date();

        runnerFindMany.mockResolvedValue([
            {
                id: 'runner-1',
                label: 'Local macOS Runner',
                kind: 'MACOS_AGENT',
                status: 'ONLINE',
                protocolVersion: '1.0.0',
                runnerVersion: '0.1.0',
                lastSeenAt: now,
                devices: [
                    {
                        id: 'device-connected-emulator',
                        deviceId: 'emulator-5556',
                        platform: 'ANDROID',
                        name: 'sdk gphone64 arm64',
                        state: 'OFFLINE',
                        metadata: {
                            inventoryKind: 'connected-device',
                            kind: 'emulator',
                        },
                        lastSeenAt: now,
                    },
                ],
            },
        ]);

        const result = await getTeamDevicesAvailability('team-hide-serial-emulator');

        expect(result.devices).toHaveLength(0);
        expect(result.availableDeviceCount).toBe(0);
    });

    it('keeps connected physical device rows visible', async () => {
        const now = new Date();

        runnerFindMany.mockResolvedValue([
            {
                id: 'runner-1',
                label: 'Local macOS Runner',
                kind: 'MACOS_AGENT',
                status: 'ONLINE',
                protocolVersion: '1.0.0',
                runnerVersion: '0.1.0',
                lastSeenAt: now,
                devices: [
                    {
                        id: 'device-physical',
                        deviceId: 'R58M1234ABC',
                        platform: 'ANDROID',
                        name: 'Samsung S24',
                        state: 'ONLINE',
                        metadata: {
                            inventoryKind: 'connected-device',
                            kind: 'physical',
                        },
                        lastSeenAt: now,
                    },
                ],
            },
        ]);

        const result = await getTeamDevicesAvailability('team-keep-physical-device');

        expect(result.devices).toHaveLength(1);
        expect(result.devices[0]).toMatchObject({
            deviceId: 'R58M1234ABC',
            name: 'Samsung S24',
            state: 'ONLINE',
        });
        expect(result.availableDeviceCount).toBe(1);
    });
});
