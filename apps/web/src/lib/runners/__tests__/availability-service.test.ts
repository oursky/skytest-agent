import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runnerFindMany, testRunFindMany } = vi.hoisted(() => ({
    runnerFindMany: vi.fn(),
    testRunFindMany: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        runner: {
            findMany: runnerFindMany,
        },
        testRun: {
            findMany: testRunFindMany,
        },
    },
}));

const { getTeamDevicesAvailability } = await import('@/lib/runners/availability-service');

describe('getTeamDevicesAvailability', () => {
    beforeEach(() => {
        runnerFindMany.mockReset();
        testRunFindMany.mockReset();
        testRunFindMany.mockResolvedValue([]);
    });

    it('deduplicates connected emulator serial rows when profile rows exist', async () => {
        const now = new Date();

        runnerFindMany.mockResolvedValue([
            {
                id: 'runner-1',
                hostFingerprint: 'host-team-1',
                displayId: 'run001',
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
                hostFingerprint: 'host-team-1',
                displayId: 'run001',
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
                hostFingerprint: 'host-team-1',
                displayId: 'run001',
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

    it('includes active same-team project occupancy metadata', async () => {
        const now = new Date();

        runnerFindMany.mockResolvedValue([
            {
                id: 'runner-1',
                hostFingerprint: 'host-team-1',
                displayId: 'run001',
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

        testRunFindMany.mockResolvedValue([
            {
                id: 'run-1',
                assignedRunnerId: 'runner-1',
                requestedDeviceId: 'R58M1234ABC',
                testCase: {
                    projectId: 'project-1',
                    project: {
                        name: 'Mobile Checkout',
                        teamId: 'team-occupancy-same-team',
                    },
                },
            },
        ]);

        const result = await getTeamDevicesAvailability('team-occupancy-same-team');

        expect(result.devices[0]).toMatchObject({
            activeRunId: 'run-1',
            activeProjectId: 'project-1',
            activeProjectName: 'Mobile Checkout',
            inUseByAnotherTeam: false,
        });
    });

    it('marks device as occupied by another team without leaking external project identity', async () => {
        const now = new Date();

        runnerFindMany.mockResolvedValue([
            {
                id: 'runner-1',
                hostFingerprint: 'host-team-1',
                displayId: 'run001',
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

        testRunFindMany.mockResolvedValue([
            {
                id: 'run-2',
                assignedRunnerId: 'runner-other',
                assignedRunner: {
                    hostFingerprint: 'host-team-1',
                },
                requestedDeviceId: 'R58M1234ABC',
                testCase: {
                    projectId: 'project-2',
                    project: {
                        name: 'External Project',
                        teamId: 'team-other',
                    },
                },
            },
        ]);

        const result = await getTeamDevicesAvailability('team-occupancy-other-team');

        expect(result.devices[0]).toMatchObject({
            activeRunId: null,
            activeProjectId: null,
            activeProjectName: null,
            inUseByAnotherTeam: true,
        });
    });

    it('does not mark occupancy from another host when deviceId matches', async () => {
        const now = new Date();

        runnerFindMany.mockResolvedValue([
            {
                id: 'runner-1',
                hostFingerprint: 'host-team-1',
                displayId: 'run001',
                label: 'Local macOS Runner',
                kind: 'MACOS_AGENT',
                status: 'ONLINE',
                protocolVersion: '1.0.0',
                runnerVersion: '0.1.0',
                lastSeenAt: now,
                devices: [
                    {
                        id: 'device-emulator-profile',
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

        testRunFindMany.mockResolvedValue([
            {
                id: 'run-3',
                assignedRunnerId: 'runner-other',
                assignedRunner: {
                    hostFingerprint: 'host-team-2',
                },
                requestedDeviceId: 'emulator-profile:Pixel_8',
                testCase: {
                    projectId: 'project-3',
                    project: {
                        name: 'Other Host Project',
                        teamId: 'team-other',
                    },
                },
            },
        ]);

        const result = await getTeamDevicesAvailability('team-occupancy-host-check');

        expect(result.devices[0]).toMatchObject({
            inUseByAnotherTeam: false,
        });
    });
});
