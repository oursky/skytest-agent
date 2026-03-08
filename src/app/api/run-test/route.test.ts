import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveUserId: vi.fn(),
    validateTargetUrl: vi.fn(),
    getTeamDevicesAvailability: vi.fn(),
    testCaseFindUnique: vi.fn(),
    testCaseFileFindMany: vi.fn(),
    testRunCreate: vi.fn(),
    startLocalBrowserRun: vi.fn(),
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

vi.mock('@/lib/runtime/local-browser-runner', () => ({
    startLocalBrowserRun: mocks.startLocalBrowserRun,
}));

const { POST } = await import('@/app/api/run-test/route');

describe('POST /api/run-test', () => {
    beforeEach(() => {
        mocks.verifyAuth.mockReset();
        mocks.resolveUserId.mockReset();
        mocks.validateTargetUrl.mockReset();
        mocks.getTeamDevicesAvailability.mockReset();
        mocks.testCaseFindUnique.mockReset();
        mocks.testCaseFileFindMany.mockReset();
        mocks.testRunCreate.mockReset();
        mocks.startLocalBrowserRun.mockReset();

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
        }));
    });

    it('creates browser runs as preparing without hosted browser runner requirements', async () => {
        const request = new Request('http://localhost/api/run-test', {
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
                status: 'PREPARING',
                requiredCapability: null,
                requiredRunnerKind: null,
            },
        });
        expect(mocks.startLocalBrowserRun).toHaveBeenCalledWith('run-1');
        expect(payload).toMatchObject({
            runId: 'run-1',
            status: 'PREPARING',
            requiredCapability: null,
        });
    });

    it('queues emulator-profile Android runs with deterministic requested device id', async () => {
        const request = new Request('http://localhost/api/run-test', {
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
        expect(mocks.startLocalBrowserRun).not.toHaveBeenCalled();
        expect(payload).toMatchObject({
            runId: 'run-1',
            status: 'QUEUED',
            requiredCapability: 'ANDROID',
            requestedDeviceId: 'emulator-profile:android_profile_a',
        });
    });
});
