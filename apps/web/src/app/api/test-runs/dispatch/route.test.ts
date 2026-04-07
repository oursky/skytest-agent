import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveUserId: vi.fn(),
    isProjectMember: vi.fn(),
    userFindUnique: vi.fn(),
    resolveConfigs: vi.fn(),
    validateTargetUrl: vi.fn(),
    getTeamDevicesAvailability: vi.fn(),
    testCaseFindUnique: vi.fn(),
    projectConfigUpsert: vi.fn(),
    testCaseFileFindMany: vi.fn(),
    testRunCreate: vi.fn(),
    ensureRuntimeInstanceIdentity: vi.fn(),
    loadRuntimeConfigForCwd: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: mocks.verifyAuth,
    resolveUserId: mocks.resolveUserId,
}));

vi.mock('@/lib/security/permissions', () => ({
    isProjectMember: mocks.isProjectMember,
}));

vi.mock('@/lib/test-config/resolver', () => ({
    resolveConfigs: mocks.resolveConfigs,
}));

vi.mock('@/lib/security/url-security', () => ({
    validateTargetUrl: mocks.validateTargetUrl,
}));

vi.mock('@/lib/runners/availability-service', () => ({
    getTeamDevicesAvailability: mocks.getTeamDevicesAvailability,
}));

vi.mock('@/lib/runtime/instance-identity', () => ({
    ensureRuntimeInstanceIdentity: mocks.ensureRuntimeInstanceIdentity,
}));

vi.mock('@/lib/runtime/runtime-config-loader', () => ({
    loadRuntimeConfigForCwd: mocks.loadRuntimeConfigForCwd,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testCase: {
            findUnique: mocks.testCaseFindUnique,
        },
        user: {
            findUnique: mocks.userFindUnique,
        },
        testCaseFile: {
            findMany: mocks.testCaseFileFindMany,
        },
        projectConfig: {
            upsert: mocks.projectConfigUpsert,
        },
        testRun: {
            create: mocks.testRunCreate,
        },
        testRunFile: {
            createMany: vi.fn(),
        },
    },
}));

const { POST } = await import('@/app/api/test-runs/dispatch/route');

describe('POST /api/test-runs/dispatch', () => {
    beforeEach(() => {
        mocks.verifyAuth.mockReset();
        mocks.resolveUserId.mockReset();
        mocks.isProjectMember.mockReset();
        mocks.userFindUnique.mockReset();
        mocks.resolveConfigs.mockReset();
        mocks.validateTargetUrl.mockReset();
        mocks.getTeamDevicesAvailability.mockReset();
        mocks.testCaseFindUnique.mockReset();
        mocks.projectConfigUpsert.mockReset();
        mocks.testCaseFileFindMany.mockReset();
        mocks.testRunCreate.mockReset();
        mocks.ensureRuntimeInstanceIdentity.mockReset();
        mocks.loadRuntimeConfigForCwd.mockReset();

        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveUserId.mockResolvedValue('user-1');
        mocks.isProjectMember.mockResolvedValue(true);
        mocks.userFindUnique.mockResolvedValue({ email: 'runner@example.com' });
        mocks.resolveConfigs.mockResolvedValue({
            variables: { CMS: 'https://example.com' },
            files: {},
            allConfigs: [],
        });
        mocks.validateTargetUrl.mockReturnValue({ valid: true });
        mocks.testCaseFindUnique.mockResolvedValue({
            id: 'tc-1',
            source: null,
            project: {
                id: 'project-1',
                teamId: 'team-1',
                team: {
                    openRouterKeyEncrypted: 'encrypted',
                    aiProvider: 'openrouter',
                    aiBaseUrl: null,
                    aiMainModel: null,
                    aiPlanningModel: null,
                    aiInsightModel: null,
                    aiTemperature: null,
                    memberships: [{ id: 'membership-1' }],
                },
            },
        });
        mocks.testCaseFileFindMany.mockResolvedValue([]);
        mocks.projectConfigUpsert.mockResolvedValue({ id: 'pc-1' });
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
        mocks.ensureRuntimeInstanceIdentity.mockResolvedValue({
            schemaVersion: 1,
            instanceId: 'inst_test_instance',
            instanceType: 'worktree',
            instanceName: 'skytest-agent-worktree-a',
            generatedAt: '2026-04-06T00:00:00.000Z',
        });
        mocks.loadRuntimeConfigForCwd.mockResolvedValue({
            schemaVersion: 1,
            runtime: {
                baseUrl: 'http://localhost:3000',
                browser: {
                    headless: true,
                    timeoutMs: 60000,
                },
                timeouts: {
                    stepMs: 20000,
                    runMs: 300000,
                },
            },
        });
    });

    it('queues browser runs for worker pickup', async () => {
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
                triggeredByEmail: 'runner@example.com',
            },
        });
        expect(payload).toMatchObject({
            runId: 'run-1',
            status: 'QUEUED',
            requiredCapability: 'BROWSER',
        });
    });

    it('stores resolved configurations in the run snapshot for history views', async () => {
        mocks.resolveConfigs.mockResolvedValueOnce({
            variables: { BASE_URL: 'https://project.example.com' },
            files: { seedCsv: 'objects/seed.csv' },
            allConfigs: [
                {
                    name: 'BASE_URL',
                    type: 'URL',
                    value: 'https://project.example.com',
                    source: 'project',
                },
                {
                    name: 'LOGIN_EMAIL',
                    type: 'VARIABLE',
                    value: 'user@example.com',
                    source: 'test-case',
                },
            ],
        });

        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                testCaseId: 'tc-1',
                url: 'https://example.com',
                prompt: 'Run smoke check',
            }),
        });

        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mocks.resolveConfigs).toHaveBeenCalledWith('project-1', 'tc-1');

        const createCall = mocks.testRunCreate.mock.calls[0]?.[0] as { data?: { configurationSnapshot?: string } } | undefined;
        expect(createCall?.data?.configurationSnapshot).toBeTypeOf('string');
        const snapshot = JSON.parse(createCall?.data?.configurationSnapshot || '{}') as {
            resolvedConfigurations?: Array<{ name: string; type: string; value: string; source: string }>;
            runtime?: {
                baseUrl: string;
                browser: { headless: boolean; timeoutMs: number };
                timeouts: { stepMs: number; runMs: number };
            };
            runtimeConfigSource?: {
                path: string;
                schemaVersion: number;
            };
        };

        expect(snapshot.resolvedConfigurations).toEqual([
            {
                name: 'BASE_URL',
                type: 'URL',
                value: 'https://project.example.com',
                source: 'project',
            },
            {
                name: 'LOGIN_EMAIL',
                type: 'VARIABLE',
                value: 'user@example.com',
                source: 'test-case',
            },
        ]);
        expect(snapshot.runtime).toEqual({
            baseUrl: 'http://localhost:3000',
            browser: {
                headless: true,
                timeoutMs: 60000,
            },
            timeouts: {
                stepMs: 20000,
                runMs: 300000,
            },
        });
        expect(snapshot.runtimeConfigSource).toEqual({
            path: '.skytest/skytest.yaml',
            schemaVersion: 1,
        });
    });

    it('overrides snapshot variables from runtime config source env when present', async () => {
        mocks.resolveConfigs.mockResolvedValueOnce({
            variables: { STUDENT_EMAIL: 'stale@example.com' },
            files: {},
            allConfigs: [
                {
                    name: 'STUDENT_EMAIL',
                    type: 'VARIABLE',
                    value: 'stale@example.com',
                    source: 'project',
                },
            ],
        });

        mocks.loadRuntimeConfigForCwd.mockResolvedValueOnce({
            schemaVersion: 1,
            runtime: {
                baseUrl: 'http://localhost:15173',
                browser: {
                    headless: true,
                    timeoutMs: 60000,
                },
                timeouts: {
                    stepMs: 20000,
                    runMs: 300000,
                },
                env: {
                    STUDENT_EMAIL: 'student+1@example.com',
                    STUDENT_PASSWORD: 'Abcd1234',
                },
            },
        });

        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                testCaseId: 'tc-1',
                url: 'https://example.com',
                prompt: 'Run smoke check',
            }),
        });

        const response = await POST(request);

        expect(response.status).toBe(200);

        const createCall = mocks.testRunCreate.mock.calls[0]?.[0] as { data?: { configurationSnapshot?: string } } | undefined;
        const snapshot = JSON.parse(createCall?.data?.configurationSnapshot || '{}') as {
            resolvedConfigurations?: Array<{ name: string; type: string; value: string; source: string; masked?: boolean }>;
        };

        expect(snapshot.resolvedConfigurations).toEqual(
            expect.arrayContaining([
                {
                    name: 'STUDENT_EMAIL',
                    type: 'VARIABLE',
                    value: 'student+1@example.com',
                    source: 'project',
                    masked: false,
                },
                {
                    name: 'STUDENT_PASSWORD',
                    type: 'VARIABLE',
                    value: 'Abcd1234',
                    source: 'project',
                    masked: true,
                },
            ])
        );
        expect(mocks.projectConfigUpsert).toHaveBeenCalledTimes(2);
        expect(mocks.projectConfigUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    projectId_name: {
                        projectId: 'project-1',
                        name: 'STUDENT_EMAIL',
                    },
                },
            })
        );
    });

    it('queues runs when runtime config is missing', async () => {
        mocks.loadRuntimeConfigForCwd.mockRejectedValueOnce(new Error('Missing runtime config: /repo/.skytest/skytest.yaml'));

        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                testCaseId: 'tc-1',
                url: 'https://example.com',
                prompt: 'Run smoke check',
            }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
        expect(mocks.testRunCreate).toHaveBeenCalledTimes(1);
        const createCall = mocks.testRunCreate.mock.calls[0]?.[0] as { data?: { configurationSnapshot?: string } } | undefined;
        const snapshot = JSON.parse(createCall?.data?.configurationSnapshot || '{}') as {
            runtime?: unknown;
            runtimeConfigSource?: unknown;
        };
        expect(snapshot.runtime).toBeUndefined();
        expect(snapshot.runtimeConfigSource).toBeUndefined();
    });

    it('returns validation error when runtime config exists but is invalid', async () => {
        mocks.loadRuntimeConfigForCwd.mockRejectedValueOnce(new Error('Invalid runtime config at /repo/.skytest/skytest.yaml: Required'));

        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                testCaseId: 'tc-1',
                url: 'https://example.com',
                prompt: 'Run smoke check',
            }),
        });

        const response = await POST(request);
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
        expect(payload).toMatchObject({
            error: 'Invalid runtime config at /repo/.skytest/skytest.yaml: Required',
            code: 'VALIDATION_ERROR',
        });
    });

    it('falls back to source-backed runtime config when cwd runtime config is missing', async () => {
        mocks.testCaseFindUnique.mockResolvedValue({
            id: 'tc-1',
            source: '/home/newman/magic/skytest-agent/examples/self-host/.skytest/tests/student/HAN-C02.case.yaml',
            project: {
                id: 'project-1',
                teamId: 'team-1',
                team: {
                    openRouterKeyEncrypted: 'encrypted',
                    aiProvider: 'openrouter',
                    aiBaseUrl: null,
                    aiMainModel: null,
                    aiPlanningModel: null,
                    aiInsightModel: null,
                    aiTemperature: null,
                    memberships: [{ id: 'membership-1' }],
                },
            },
        });

        mocks.loadRuntimeConfigForCwd
            .mockRejectedValueOnce(new Error('Missing runtime config: /home/newman/magic/skytest-agent/apps/web/.skytest/skytest.yaml'))
            .mockResolvedValueOnce({
                schemaVersion: 1,
                runtime: {
                    baseUrl: 'http://localhost:15173',
                    browser: {
                        headless: true,
                        timeoutMs: 60000,
                    },
                    timeouts: {
                        stepMs: 20000,
                        runMs: 300000,
                    },
                },
            });

        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                testCaseId: 'tc-1',
                url: 'https://example.com',
                prompt: 'Run smoke check',
            }),
        });

        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mocks.loadRuntimeConfigForCwd).toHaveBeenNthCalledWith(2, '/home/newman/magic/skytest-agent/examples/self-host');
    });

    it('stores runtime instance metadata on queued runs', async () => {
        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                testCaseId: 'tc-1',
                url: 'https://example.com',
                prompt: 'Run smoke check',
            }),
        });

        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mocks.testRunCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                instanceId: 'inst_test_instance',
                instanceType: 'worktree',
                instanceName: 'skytest-agent-worktree-a',
            }),
        });
    });

    it('resolves URL placeholders before validating and queueing', async () => {
        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                testCaseId: 'tc-1',
                url: '{{CMS}}',
                prompt: 'Open homepage and verify title',
                browserConfig: {
                    browserA: {
                        type: 'browser',
                        name: 'Browser A',
                        url: '{{CMS}}',
                        width: 1440,
                        height: 900,
                    },
                },
            }),
        });

        const response = await POST(request);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.resolveConfigs).toHaveBeenCalledWith('project-1', 'tc-1');
        expect(mocks.validateTargetUrl).toHaveBeenCalledWith('https://example.com');
        expect(payload).toMatchObject({
            runId: 'run-1',
            status: 'QUEUED',
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
        expect(payload).toMatchObject({
            runId: 'run-1',
            status: 'QUEUED',
            requiredCapability: 'ANDROID',
            requestedDeviceId: 'emulator-profile:android_profile_a',
        });
    });

    it('infers requestedRunnerId from Android target runnerScope when override is omitted', async () => {
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
                        runnerScope: {
                            runnerId: 'runner-1',
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
        expect(mocks.testRunCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                requestedDeviceId: 'emulator-profile:android_profile_a',
                requestedRunnerId: 'runner-1',
            }),
        });
        expect(payload).toMatchObject({
            requestedRunnerId: 'runner-1',
        });
    });

    it('rejects Android runs when multiple selectors prevent requestedDeviceId resolution', async () => {
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
                        name: 'Pixel 8 A',
                        deviceSelector: {
                            mode: 'emulator-profile',
                            emulatorProfileName: 'android_profile_a',
                        },
                        runnerScope: {
                            runnerId: 'runner-1',
                        },
                        appId: 'com.example.app',
                        clearAppState: true,
                        allowAllPermissions: true,
                    },
                    android_b: {
                        type: 'android',
                        name: 'Pixel 8 B',
                        deviceSelector: {
                            mode: 'emulator-profile',
                            emulatorProfileName: 'android_profile_b',
                        },
                        runnerScope: {
                            runnerId: 'runner-1',
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
        expect(mocks.getTeamDevicesAvailability).not.toHaveBeenCalled();
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
        expect(payload).toMatchObject({
            error: 'Android runs require a single requestedDeviceId. Align Android target selectors or provide requestedDeviceId override.',
        });
    });

    it('rejects Android targets with ambiguous runner scope inference', async () => {
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
                        name: 'Pixel 8 A',
                        deviceSelector: {
                            mode: 'emulator-profile',
                            emulatorProfileName: 'android_profile_a',
                        },
                        runnerScope: {
                            runnerId: 'runner-1',
                        },
                        appId: 'com.example.app',
                        clearAppState: true,
                        allowAllPermissions: true,
                    },
                    android_b: {
                        type: 'android',
                        name: 'Pixel 8 B',
                        deviceSelector: {
                            mode: 'emulator-profile',
                            emulatorProfileName: 'android_profile_b',
                        },
                        runnerScope: {
                            runnerId: 'runner-2',
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
        expect(payload).toMatchObject({
            error: 'Android runs require a single requestedDeviceId. Align Android target selectors or provide requestedDeviceId override.',
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

    it('rejects requestedRunnerId override that conflicts with Android target runnerScope', async () => {
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
                        runnerScope: {
                            runnerId: 'runner-1',
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
        expect(payload).toMatchObject({
            error: 'requestedRunnerId must match an Android target runner scope',
        });
    });

    it('returns generic AI provider key message when team key is missing', async () => {
        // guardTestCaseRouteRequest and route logic both resolve test case ownership.
        // Force both reads to return missing key state.
        mocks.testCaseFindUnique.mockResolvedValueOnce({
            id: 'tc-1',
            project: {
                id: 'project-1',
                teamId: 'team-1',
                team: {
                    openRouterKeyEncrypted: null,
                    aiProvider: 'openai-compatible',
                    aiBaseUrl: 'https://api.openai.com/v1',
                    aiMainModel: 'gpt-5.3-codex',
                    aiPlanningModel: 'gpt-5.3-mini',
                    aiInsightModel: 'gpt-5.3-mini',
                    aiTemperature: 0.3,
                },
            },
        });
        mocks.testCaseFindUnique.mockResolvedValueOnce({
            id: 'tc-1',
            project: {
                id: 'project-1',
                teamId: 'team-1',
                team: {
                    openRouterKeyEncrypted: null,
                    aiProvider: 'openai-compatible',
                    aiBaseUrl: 'https://api.openai.com/v1',
                    aiMainModel: 'gpt-5.3-codex',
                    aiPlanningModel: 'gpt-5.3-mini',
                    aiInsightModel: 'gpt-5.3-mini',
                    aiTemperature: 0.3,
                },
            },
        });

        const request = new Request('http://localhost/api/test-runs/dispatch', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                testCaseId: 'tc-1',
                url: 'https://example.com',
                prompt: 'Run smoke check',
            }),
        });

        const response = await POST(request);
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload).toMatchObject({
            error: 'Please configure this team AI provider key',
            code: 'VALIDATION_ERROR',
        });
    });
});
