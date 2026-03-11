import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    projectFindUnique: vi.fn(),
    getTeamDevicesAvailability: vi.fn(),
    getTeamRunnersOverview: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        project: {
            findUnique: mocks.projectFindUnique,
        },
    },
}));

vi.mock('@/lib/runners/availability-service', () => ({
    getTeamDevicesAvailability: mocks.getTeamDevicesAvailability,
    getTeamRunnersOverview: mocks.getTeamRunnersOverview,
}));

const { getProjectRunnerInventory } = await import('@/lib/mcp/runner-inventory');

describe('getProjectRunnerInventory', () => {
    beforeEach(() => {
        mocks.projectFindUnique.mockReset();
        mocks.getTeamDevicesAvailability.mockReset();
        mocks.getTeamRunnersOverview.mockReset();
    });

    it('returns null when project does not exist', async () => {
        mocks.projectFindUnique.mockResolvedValueOnce(null);

        await expect(getProjectRunnerInventory('project-1')).resolves.toBeNull();
    });

    it('builds android selector options from team inventory', async () => {
        mocks.projectFindUnique.mockResolvedValueOnce({ teamId: 'team-1' });
        mocks.getTeamRunnersOverview.mockResolvedValueOnce({
            teamId: 'team-1',
            runnerConnected: true,
            macRunnerOnlineCount: 1,
            refreshedAt: '2026-03-09T00:00:00.000Z',
            runners: [{
                id: 'runner-1',
                displayId: 'run001',
                label: 'Runner 1',
                kind: 'MACOS_AGENT',
                status: 'ONLINE',
                protocolVersion: '1.0.0',
                runnerVersion: '0.1.0',
                lastSeenAt: '2026-03-09T00:00:00.000Z',
                isFresh: true,
                deviceCount: 2,
                availableDeviceCount: 2,
            }],
        });
        mocks.getTeamDevicesAvailability.mockResolvedValueOnce({
            teamId: 'team-1',
            runnerConnected: true,
            availableDeviceCount: 2,
            staleDeviceCount: 0,
            refreshedAt: '2026-03-09T00:00:00.000Z',
            devices: [
                {
                    id: 'dev-1',
                    runnerId: 'runner-1',
                    runnerLabel: 'Runner 1',
                    deviceId: 'emulator-5554',
                    name: 'Pixel 8',
                    platform: 'ANDROID',
                    state: 'ONLINE',
                    metadata: { kind: 'emulator', model: 'Pixel 8' },
                    lastSeenAt: '2026-03-09T00:00:00.000Z',
                    isFresh: true,
                    isAvailable: true,
                },
                {
                    id: 'dev-2',
                    runnerId: 'runner-1',
                    runnerLabel: 'Runner 1',
                    deviceId: 'emulator-profile:android_profile_a',
                    name: 'Medium Phone',
                    platform: 'ANDROID',
                    state: 'ONLINE',
                    metadata: {
                        inventoryKind: 'emulator-profile',
                        emulatorProfileName: 'android_profile_a',
                        emulatorProfileDisplayName: 'Medium Phone',
                    },
                    lastSeenAt: '2026-03-09T00:00:00.000Z',
                    isFresh: true,
                    isAvailable: true,
                }
            ],
        });

        const result = await getProjectRunnerInventory('project-1');

        expect(result).not.toBeNull();
        if (!result) {
            throw new Error('Expected inventory result');
        }
        expect(result.runnerConnected).toBe(true);
        expect(result.androidSelectors.connectedDevices).toHaveLength(1);
        expect(result.androidSelectors.connectedDevices[0].selector).toEqual({
            mode: 'connected-device',
            serial: 'emulator-5554',
        });
        expect(result.androidSelectors.emulatorProfiles).toHaveLength(1);
        expect(result.androidSelectors.emulatorProfiles[0].selector).toEqual({
            mode: 'emulator-profile',
            emulatorProfileName: 'android_profile_a',
        });
    });
});
