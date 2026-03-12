import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveUserId: vi.fn(),
    validateTargetUrl: vi.fn(),
    getTeamDevicesAvailability: vi.fn(),
    testCaseFindUnique: vi.fn(),
    testCaseFileFindMany: vi.fn(),
    testRunCreate: vi.fn(),
    dispatchBrowserRun: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: mocks.verifyAuth,
    resolveUserId: mocks.resolveUserId,
}));

vi.mock('@/lib/security/url-security', () => ({
    validateTargetUrl: mocks.validateTargetUrl,
}));

vi.mock('@/lib/runners/availability-service', () => ({
    getTeamDevicesAvailability: mocks.getTeamDevicesAvailability,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testCase: {
            findUnique: mocks.testCaseFindUnique,
        },
        testCaseFile: {
            findMany: mocks.testCaseFileFindMany,
        },
        testRun: {
            create: mocks.testRunCreate,
        },
        testRunFile: {
            createMany: vi.fn(),
        },
    },
}));

vi.mock('@/lib/runtime/browser-run-dispatcher', () => ({
    dispatchBrowserRun: mocks.dispatchBrowserRun,
}));

const { POST } = await import('@/app/api/test-runs/dispatch/route');

describe('POST /api/test-runs/dispatch', () => {
    beforeEach(() => {
        mocks.verifyAuth.mockReset();
        mocks.resolveUserId.mockReset();
        mocks.validateTargetUrl.mockReset();
        mocks.getTeamDevicesAvailability.mockReset();
        mocks.testCaseFindUnique.mockReset();
        mocks.testCaseFileFindMany.mockReset();
        mocks.testRunCreate.mockReset();
        mocks.dispatchBrowserRun.mockReset();

        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveUserId.mockResolvedValue('user-1');
        mocks.validateTargetUrl.mockReturnValue({ valid: true });
        mocks.testCaseFindUnique.mockResolvedValue({
            id: 'tc-1',
            project: {
                id: 'project-1',
                teamId: 'team-1',
                team: {
                    openRouterKeyEncrypted: 'encrypted',
                    memberships: [{ id: 'membership-1' }],
                },
            },
        });
        mocks.testCaseFileFindMany.mockResolvedValue([]);
        mocks.getTeamDevicesAvailability.mockResolvedValue({
            runnerConnected: true,
            devices: [
                {
                    id: 'device-1',
                    runnerId: 'runner-1',
                    deviceId: 'emulator-profile:android_profile_a',
                    metadata: { inventoryKind: 'emulator-profile', emulatorProfileName: 'android_profile_a' },
                    isAvailable: false,
                    isFresh: true,
                },
            ],
        });
        mocks.testRunCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'run-1',
            status: String(data.status),
            requiredCapability: data.requiredCapability ?? null,
            requestedDeviceId: data.requestedDeviceId ?? null,
            requestedRunnerId: data.requestedRunnerId ?? null,
        }));
        mocks.dispatchBrowserRun.mockResolvedValue(true);
    });

    it('queues browser runs and dispatches local browser execution', async () => {
        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                testCaseId: 'tc-1',
                url: 'https://example.com',
                prompt: 'Open homepage and verify title',
                browserConfig: {
                    browserA: {
                        type: 'browser',
                        name: 'Browser A',
                        url: 'https://example.com',
                        width: 1440,
                        height: 900,
                    },
                },
            }),
        });

        const response = await POST(request);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.testRunCreate).toHaveBeenCalledTimes(1);
        expect(mocks.testRunCreate.mock.calls[0][0]).toMatchObject({
            data: {
                status: 'QUEUED',
                requiredCapability: 'BROWSER',
                requiredRunnerKind: null,
            },
        });
        expect(mocks.dispatchBrowserRun).toHaveBeenCalledWith('run-1');
        expect(payload).toMatchObject({
            runId: 'run-1',
            status: 'QUEUED',
            requiredCapability: 'BROWSER',
        });
    });

    it('queues emulator-profile Android runs with deterministic requested device id', async () => {
        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                testCaseId: 'tc-1',
                steps: [{ id: 'step-1', target: 'android_a', action: 'Open app', type: 'ai-action' }],
                browserConfig: {
                    android_a: {
                        type: 'android',
                        name: 'Pixel 8 target',
                        deviceSelector: {
                            mode: 'emulator-profile',
                            emulatorProfileName: 'android_profile_a',
                        },
                        appId: 'com.example.app',
                        clearAppState: true,
                        allowAllPermissions: true,
                    },
                },
            }),
        });

        const response = await POST(request);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.testRunCreate).toHaveBeenCalledTimes(1);
        expect(mocks.testRunCreate.mock.calls[0][0]).toMatchObject({
            data: {
                status: 'QUEUED',
                requiredCapability: 'ANDROID',
                requiredRunnerKind: 'MACOS_AGENT',
                requestedDeviceId: 'emulator-profile:android_profile_a',
            },
        });
        expect(mocks.dispatchBrowserRun).not.toHaveBeenCalled();
        expect(payload).toMatchObject({
            runId: 'run-1',
            status: 'QUEUED',
            requiredCapability: 'ANDROID',
            requestedDeviceId: 'emulator-profile:android_profile_a',
        });
    });

    it('rejects requestedDeviceId that does not match Android target selectors', async () => {
        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                testCaseId: 'tc-1',
                steps: [{ id: 'step-1', target: 'android_a', action: 'Open app', type: 'ai-action' }],
                requestedDeviceId: 'emulator-profile:android_profile_b',
                browserConfig: {
                    android_a: {
                        type: 'android',
                        name: 'Pixel 8 target',
                        deviceSelector: {
                            mode: 'emulator-profile',
                            emulatorProfileName: 'android_profile_a',
                        },
                        appId: 'com.example.app',
                        clearAppState: true,
                        allowAllPermissions: true,
                    },
                },
            }),
        });

        const response = await POST(request);
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
        expect(mocks.dispatchBrowserRun).not.toHaveBeenCalled();
        expect(payload).toMatchObject({
            error: 'requestedDeviceId must match an Android target device selector',
        });
    });

    it('rejects requestedRunnerId when runner-device pair is not available', async () => {
        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                testCaseId: 'tc-1',
                steps: [{ id: 'step-1', target: 'android_a', action: 'Open app', type: 'ai-action' }],
                requestedDeviceId: 'emulator-profile:android_profile_a',
                requestedRunnerId: 'runner-2',
                browserConfig: {
                    android_a: {
                        type: 'android',
                        name: 'Pixel 8 target',
                        deviceSelector: {
                            mode: 'emulator-profile',
                            emulatorProfileName: 'android_profile_a',
                        },
                        appId: 'com.example.app',
                        clearAppState: true,
                        allowAllPermissions: true,
                    },
                },
            }),
        });

        const response = await POST(request);
        const payload = await response.json();

        expect(response.status).toBe(409);
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
        expect(payload).toMatchObject({
            error: 'Selected device is no longer available. Check Team Settings > Runners and choose an available device.',
        });
    });
});
