import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    testCaseFindUnique: vi.fn(),
    testRunCreate: vi.fn(),
    testRunFileCreateMany: vi.fn(),
    validateTargetUrl: vi.fn(),
    getTeamDevicesAvailability: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testCase: {
            findUnique: mocks.testCaseFindUnique,
        },
        testRun: {
            create: mocks.testRunCreate,
        },
        testRunFile: {
            createMany: mocks.testRunFileCreateMany,
        },
    },
}));

vi.mock('@/lib/security/url-security', () => ({
    validateTargetUrl: mocks.validateTargetUrl,
}));

vi.mock('@/lib/runners/availability-service', () => ({
    getTeamDevicesAvailability: mocks.getTeamDevicesAvailability,
}));

const { queueTestCaseRun } = await import('@/lib/mcp/run-execution');

describe('queueTestCaseRun', () => {
    beforeEach(() => {
        mocks.testCaseFindUnique.mockReset();
        mocks.testRunCreate.mockReset();
        mocks.testRunFileCreateMany.mockReset();
        mocks.validateTargetUrl.mockReset();
        mocks.getTeamDevicesAvailability.mockReset();

        mocks.validateTargetUrl.mockReturnValue({ valid: true });
        mocks.testRunCreate.mockResolvedValue({
            id: 'run-1',
            status: 'QUEUED',
            requiredCapability: 'BROWSER',
            requestedDeviceId: null,
        });
        mocks.testRunFileCreateMany.mockResolvedValue({ count: 0 });
    });

    it('queues a browser run with default test case configuration', async () => {
        mocks.testCaseFindUnique.mockResolvedValueOnce({
            id: 'tc-1',
            url: 'https://example.com',
            prompt: 'Open homepage',
            steps: JSON.stringify([{ id: 'step_1', target: 'browser_a', action: 'Open homepage' }]),
            browserConfig: JSON.stringify({
                browser_a: { type: 'browser', url: 'https://example.com', width: 1280, height: 800 }
            }),
            files: [{ filename: 'seed.txt', storedName: 'runs/seed.txt', mimeType: 'text/plain', size: 12 }],
            project: {
                teamId: 'team-1',
                team: {
                    openRouterKeyEncrypted: 'encrypted-key',
                    memberships: [{ id: 'm-1' }],
                },
            },
        });

        const result = await queueTestCaseRun('user-1', 'tc-1');

        expect(result.ok).toBe(true);
        if (!result.ok) {
            throw new Error('Expected run queue success');
        }
        expect(result.data).toEqual({
            runId: 'run-1',
            status: 'QUEUED',
            requiredCapability: 'BROWSER',
            requestedDeviceId: null,
        });
        expect(mocks.testRunCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                testCaseId: 'tc-1',
                status: 'QUEUED',
                requiredCapability: 'BROWSER',
                requiredRunnerKind: 'BROWSER_WORKER',
            }),
        });
        expect(mocks.testRunFileCreateMany).toHaveBeenCalledTimes(1);
    });

    it('returns failure when requested Android device is unavailable', async () => {
        mocks.testCaseFindUnique.mockResolvedValueOnce({
            id: 'tc-1',
            url: '',
            prompt: 'Open app',
            steps: JSON.stringify([{ id: 'step_1', target: 'android_a', action: 'Open app' }]),
            browserConfig: JSON.stringify({
                android_a: {
                    type: 'android',
                    deviceSelector: { mode: 'emulator-profile', emulatorProfileName: 'android_profile_a' },
                    appId: 'com.example.app',
                    clearAppState: true,
                    allowAllPermissions: true,
                }
            }),
            files: [],
            project: {
                teamId: 'team-1',
                team: {
                    openRouterKeyEncrypted: 'encrypted-key',
                    memberships: [{ id: 'm-1' }],
                },
            },
        });
        mocks.getTeamDevicesAvailability.mockResolvedValueOnce({
            teamId: 'team-1',
            runnerConnected: true,
            availableDeviceCount: 0,
            staleDeviceCount: 0,
            refreshedAt: new Date().toISOString(),
            devices: [],
        });

        const result = await queueTestCaseRun('user-1', 'tc-1', {
            requestedDeviceId: 'emulator-profile:android_profile_a',
        });

        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error('Expected run queue failure');
        }
        expect(result.failure.error).toContain('Selected device is no longer available');
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
    });
});
