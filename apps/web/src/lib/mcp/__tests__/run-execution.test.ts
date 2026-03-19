import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    testCaseFindUnique: vi.fn(),
    testRunCreate: vi.fn(),
    testRunFileCreateMany: vi.fn(),
    resolveConfigs: vi.fn(),
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

vi.mock('@/lib/test-config/resolver', () => ({
    resolveConfigs: mocks.resolveConfigs,
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
        mocks.resolveConfigs.mockReset();
        mocks.validateTargetUrl.mockReset();
        mocks.getTeamDevicesAvailability.mockReset();

        mocks.resolveConfigs.mockResolvedValue({
            variables: { CMS: 'https://example.com' },
            files: {},
            allConfigs: [],
        });
        mocks.validateTargetUrl.mockReturnValue({ valid: true });
        mocks.testRunCreate.mockResolvedValue({
            id: 'run-1',
            status: 'QUEUED',
            requiredCapability: 'BROWSER',
            requestedDeviceId: null,
            requestedRunnerId: null,
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
            requestedRunnerId: null,
        });
        expect(mocks.testRunCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                testCaseId: 'tc-1',
                status: 'QUEUED',
                requiredCapability: 'BROWSER',
                requiredRunnerKind: null,
            }),
        });
        expect(mocks.testRunFileCreateMany).toHaveBeenCalledTimes(1);
    });

    it('resolves URL placeholders before validating and queueing', async () => {
        mocks.testCaseFindUnique.mockResolvedValueOnce({
            id: 'tc-1',
            projectId: 'project-1',
            url: '{{CMS}}',
            prompt: 'Open homepage',
            steps: JSON.stringify([{ id: 'step_1', target: 'browser_a', action: 'Open homepage' }]),
            browserConfig: JSON.stringify({
                browser_a: { type: 'browser', url: '{{CMS}}', width: 1280, height: 800 }
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

        const result = await queueTestCaseRun('user-1', 'tc-1');

        expect(result.ok).toBe(true);
        expect(mocks.resolveConfigs).toHaveBeenCalledWith('project-1', 'tc-1');
        expect(mocks.validateTargetUrl).toHaveBeenCalledWith('https://example.com');
        expect(mocks.testRunCreate).toHaveBeenCalledTimes(1);
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

    it('returns failure when requestedDeviceId does not match Android target selectors', async () => {
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

        const result = await queueTestCaseRun('user-1', 'tc-1', {
            requestedDeviceId: 'emulator-profile:android_profile_b',
        });

        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error('Expected run queue failure');
        }
        expect(result.failure.error).toBe('requestedDeviceId must match an Android target device selector');
        expect(mocks.getTeamDevicesAvailability).not.toHaveBeenCalled();
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
    });

    it('returns failure when requestedRunnerId does not match available runner-device pair', async () => {
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
            availableDeviceCount: 1,
            staleDeviceCount: 0,
            refreshedAt: new Date().toISOString(),
            devices: [{
                id: 'device-1',
                runnerId: 'runner-1',
                deviceId: 'emulator-profile:android_profile_a',
                metadata: { inventoryKind: 'emulator-profile', emulatorProfileName: 'android_profile_a' },
                isAvailable: true,
                isFresh: true,
            }],
        });

        const result = await queueTestCaseRun('user-1', 'tc-1', {
            requestedDeviceId: 'emulator-profile:android_profile_a',
            requestedRunnerId: 'runner-2',
        });

        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error('Expected run queue failure');
        }
        expect(result.failure.error).toContain('Selected device is no longer available');
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
    });

    it('infers requestedRunnerId from Android target runnerScope when override is omitted', async () => {
        mocks.testCaseFindUnique.mockResolvedValueOnce({
            id: 'tc-1',
            url: '',
            prompt: 'Open app',
            steps: JSON.stringify([{ id: 'step_1', target: 'android_a', action: 'Open app' }]),
            browserConfig: JSON.stringify({
                android_a: {
                    type: 'android',
                    deviceSelector: { mode: 'emulator-profile', emulatorProfileName: 'android_profile_a' },
                    runnerScope: { runnerId: 'runner-1' },
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
            availableDeviceCount: 1,
            staleDeviceCount: 0,
            refreshedAt: new Date().toISOString(),
            devices: [{
                id: 'device-1',
                runnerId: 'runner-1',
                deviceId: 'emulator-profile:android_profile_a',
                metadata: { inventoryKind: 'emulator-profile', emulatorProfileName: 'android_profile_a' },
                isAvailable: true,
                isFresh: true,
            }],
        });
        mocks.testRunCreate.mockResolvedValueOnce({
            id: 'run-android-1',
            status: 'QUEUED',
            requiredCapability: 'ANDROID',
            requestedDeviceId: 'emulator-profile:android_profile_a',
            requestedRunnerId: 'runner-1',
        });

        const result = await queueTestCaseRun('user-1', 'tc-1');

        expect(result.ok).toBe(true);
        if (!result.ok) {
            throw new Error('Expected run queue success');
        }
        expect(result.data.requestedRunnerId).toBe('runner-1');
        expect(mocks.testRunCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                requestedRunnerId: 'runner-1',
            }),
        });
    });

    it('returns failure when multiple selectors prevent requestedDeviceId resolution', async () => {
        mocks.testCaseFindUnique.mockResolvedValueOnce({
            id: 'tc-1',
            url: '',
            prompt: 'Open app',
            steps: JSON.stringify([{ id: 'step_1', target: 'android_a', action: 'Open app' }]),
            browserConfig: JSON.stringify({
                android_a: {
                    type: 'android',
                    deviceSelector: { mode: 'emulator-profile', emulatorProfileName: 'android_profile_a' },
                    runnerScope: { runnerId: 'runner-1' },
                    appId: 'com.example.app',
                    clearAppState: true,
                    allowAllPermissions: true,
                },
                android_b: {
                    type: 'android',
                    deviceSelector: { mode: 'emulator-profile', emulatorProfileName: 'android_profile_b' },
                    runnerScope: { runnerId: 'runner-1' },
                    appId: 'com.example.app',
                    clearAppState: true,
                    allowAllPermissions: true,
                },
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
        mocks.testRunCreate.mockResolvedValueOnce({
            id: 'run-android-multi',
            status: 'QUEUED',
            requiredCapability: 'ANDROID',
            requestedDeviceId: null,
            requestedRunnerId: 'runner-1',
        });

        const result = await queueTestCaseRun('user-1', 'tc-1');

        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error('Expected run queue failure');
        }
        expect(mocks.getTeamDevicesAvailability).not.toHaveBeenCalled();
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
        expect(result.failure.error).toBe(
            'Android runs require a single requestedDeviceId. Align Android target selectors or provide requestedDeviceId override.'
        );
    });

    it('returns failure when Android targets have ambiguous runner scope inference', async () => {
        mocks.testCaseFindUnique.mockResolvedValueOnce({
            id: 'tc-1',
            url: '',
            prompt: 'Open app',
            steps: JSON.stringify([{ id: 'step_1', target: 'android_a', action: 'Open app' }]),
            browserConfig: JSON.stringify({
                android_a: {
                    type: 'android',
                    deviceSelector: { mode: 'emulator-profile', emulatorProfileName: 'android_profile_a' },
                    runnerScope: { runnerId: 'runner-1' },
                    appId: 'com.example.app',
                    clearAppState: true,
                    allowAllPermissions: true,
                },
                android_b: {
                    type: 'android',
                    deviceSelector: { mode: 'emulator-profile', emulatorProfileName: 'android_profile_b' },
                    runnerScope: { runnerId: 'runner-2' },
                    appId: 'com.example.app',
                    clearAppState: true,
                    allowAllPermissions: true,
                },
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

        const result = await queueTestCaseRun('user-1', 'tc-1');

        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error('Expected run queue failure');
        }
        expect(result.failure.error).toBe(
            'Android runs require a single requestedDeviceId. Align Android target selectors or provide requestedDeviceId override.'
        );
        expect(mocks.getTeamDevicesAvailability).not.toHaveBeenCalled();
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
    });

    it('returns failure when requestedRunnerId override conflicts with Android target runnerScope', async () => {
        mocks.testCaseFindUnique.mockResolvedValueOnce({
            id: 'tc-1',
            url: '',
            prompt: 'Open app',
            steps: JSON.stringify([{ id: 'step_1', target: 'android_a', action: 'Open app' }]),
            browserConfig: JSON.stringify({
                android_a: {
                    type: 'android',
                    deviceSelector: { mode: 'emulator-profile', emulatorProfileName: 'android_profile_a' },
                    runnerScope: { runnerId: 'runner-1' },
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

        const result = await queueTestCaseRun('user-1', 'tc-1', {
            requestedDeviceId: 'emulator-profile:android_profile_a',
            requestedRunnerId: 'runner-2',
        });

        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error('Expected run queue failure');
        }
        expect(result.failure.error).toBe('requestedRunnerId must match an Android target runner scope');
        expect(mocks.getTeamDevicesAvailability).not.toHaveBeenCalled();
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
    });
});
