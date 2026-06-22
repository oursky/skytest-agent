import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    guardTestCaseRouteRequest: vi.fn(),
    userFindUnique: vi.fn(),
    resolveConfigs: vi.fn(),
    testCaseFindUnique: vi.fn(),
    projectConfigUpsert: vi.fn(),
    testCaseFileFindMany: vi.fn(),
    testRunCreate: vi.fn(),
    createRunSession: vi.fn(),
    ensureRuntimeInstanceIdentity: vi.fn(),
    loadRuntimeConfigForCwd: vi.fn(),
    validateConfigUrls: vi.fn(),
}));

vi.mock('@/lib/runtime/run-session-service', () => ({
    createRunSession: mocks.createRunSession,
}));

vi.mock('@/lib/security/test-case-route-access', () => ({
    guardTestCaseRouteRequest: mocks.guardTestCaseRouteRequest,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testCase: { findUnique: mocks.testCaseFindUnique },
        user: { findUnique: mocks.userFindUnique },
        testCaseFile: { findMany: mocks.testCaseFileFindMany },
        projectConfig: { upsert: mocks.projectConfigUpsert },
        testRun: { create: mocks.testRunCreate },
        testRunFile: { createMany: vi.fn() },
    },
}));

vi.mock('@/lib/test-config/resolver', () => ({
    resolveConfigs: mocks.resolveConfigs,
}));

vi.mock('@/lib/runtime/instance-identity', () => ({
    ensureRuntimeInstanceIdentity: mocks.ensureRuntimeInstanceIdentity,
}));

vi.mock('@/lib/runtime/runtime-config-loader', () => ({
    loadRuntimeConfigForCwd: mocks.loadRuntimeConfigForCwd,
}));

vi.mock('@/lib/test-config/url-validation', () => ({
    hasTemplatedConfigUrls: vi.fn().mockReturnValue(false),
    validateConfigUrls: mocks.validateConfigUrls,
}));

const { POST } = await import('@/app/api/test-runs/dispatch/route');

describe('POST /api/test-runs/dispatch runtime identity', () => {
    beforeEach(() => {
        mocks.guardTestCaseRouteRequest.mockReset();
        mocks.userFindUnique.mockReset();
        mocks.resolveConfigs.mockReset();
        mocks.testCaseFindUnique.mockReset();
        mocks.projectConfigUpsert.mockReset();
        mocks.testCaseFileFindMany.mockReset();
        mocks.testRunCreate.mockReset();
        mocks.createRunSession.mockReset();
        mocks.createRunSession.mockResolvedValue('session-1');
        mocks.ensureRuntimeInstanceIdentity.mockReset();
        mocks.loadRuntimeConfigForCwd.mockReset();
        mocks.validateConfigUrls.mockReset();

        mocks.guardTestCaseRouteRequest.mockResolvedValue({
            ok: true,
            userId: 'user-1',
            testCaseId: 'tc-1',
        });
        mocks.userFindUnique.mockResolvedValue({ email: 'runner@example.com' });
        mocks.resolveConfigs.mockResolvedValue({
            variables: {},
            files: {},
            allConfigs: [],
        });
        mocks.validateConfigUrls.mockReturnValue(null);
        mocks.testCaseFindUnique.mockResolvedValue({
            id: 'tc-1',
            source: null,
            project: {
                id: 'project-1',
                teamId: 'team-1',
                team: {
                    openRouterKeyEncrypted: 'encrypted',
                },
            },
        });
        mocks.testCaseFileFindMany.mockResolvedValue([]);
        mocks.testRunCreate.mockResolvedValue({
            id: 'run-1',
            status: 'QUEUED',
            requiredCapability: 'BROWSER',
            requestedDeviceId: null,
            requestedRunnerId: null,
        });
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

    it('returns validation error when runtime identity initialization fails', async () => {
        mocks.ensureRuntimeInstanceIdentity.mockRejectedValueOnce(
            new Error('EACCES: permission denied, mkdir')
        );

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
            code: 'VALIDATION_ERROR',
            error: `Runtime instance identity initialization failed. Ensure the server can write to ${path.join(process.cwd(), '.skytest')}.`,
        });
    });

    it('uses source runtime root for instance identity when source-backed', async () => {
        mocks.testCaseFindUnique.mockResolvedValue({
            id: 'tc-1',
            source: '/tmp/sample-workspace/examples/self-host/.skytest/tests/scenario-a/CASE-A02.case.yaml',
            project: {
                id: 'project-1',
                teamId: 'team-1',
                team: {
                    openRouterKeyEncrypted: 'encrypted',
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
        expect(mocks.ensureRuntimeInstanceIdentity).toHaveBeenCalledWith('/tmp/sample-workspace/examples/self-host');
    });
});
