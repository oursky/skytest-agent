import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveUserId: vi.fn(),
    isProjectMember: vi.fn(),
    projectFindUnique: vi.fn(),
    testCaseFindMany: vi.fn(),
    testCaseUpdate: vi.fn(),
    testCaseCreate: vi.fn(),
    projectConfigUpsert: vi.fn(),
    loadRuntimeConfigForCwd: vi.fn(),
    loadTestCatalog: vi.fn(),
    existsSync: vi.fn(),
    readFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
    existsSync: mocks.existsSync,
}));

vi.mock('node:fs/promises', () => ({
    readFile: mocks.readFile,
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: mocks.verifyAuth,
    resolveUserId: mocks.resolveUserId,
}));

vi.mock('@/lib/security/permissions', () => ({
    isProjectMember: mocks.isProjectMember,
}));

vi.mock('@/lib/runtime/runtime-config-loader', () => ({
    loadRuntimeConfigForCwd: mocks.loadRuntimeConfigForCwd,
}));

vi.mock('@/lib/test-cases/catalog-loader', () => ({
    loadTestCatalog: mocks.loadTestCatalog,
    hashCatalogDocument: (content: string) => `hash:${content}`,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        project: { findUnique: mocks.projectFindUnique },
        testCase: {
            findMany: mocks.testCaseFindMany,
            update: mocks.testCaseUpdate,
            create: mocks.testCaseCreate,
        },
        projectConfig: {
            upsert: mocks.projectConfigUpsert,
        },
    },
}));

const { POST } = await import('@/app/api/projects/[id]/test-cases/sync/route');

describe('POST /api/projects/[id]/test-cases/sync', () => {
    beforeEach(() => {
        vi.resetAllMocks();

        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveUserId.mockResolvedValue('user-1');
        mocks.projectFindUnique.mockResolvedValue({ id: 'project-1' });
        mocks.isProjectMember.mockResolvedValue(true);
        mocks.testCaseFindMany.mockResolvedValue([
            { id: 'tc-existing', displayId: 'CASE-A02', status: 'DRAFT' },
        ]);
        mocks.loadRuntimeConfigForCwd.mockResolvedValue({
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
                    USER_EMAIL: 'user@example.com',
                },
            },
        });
        mocks.existsSync.mockReturnValue(true);
        mocks.loadTestCatalog.mockResolvedValue({
            catalog: new Map([
                ['CASE-A02', { id: 'CASE-A02', sourcePath: '/tmp/sample-workspace/.skytest/tests/scenario-a/CASE-A02.case.yaml', sourceHash: 'hash-a' }],
                ['CASE-B01', { id: 'CASE-B01', sourcePath: '/tmp/sample-workspace/.skytest/tests/scenario-b/CASE-B01.case.yaml', sourceHash: 'hash-b' }],
            ]),
            errors: [],
        });
        mocks.readFile.mockImplementation(async (sourcePath: string) => {
            if (sourcePath.includes('CASE-A02')) {
                return `id: CASE-A02\nname: Scenario A baseline\nurl: http://localhost:15173/mock-exam/dashboard\nsteps: []\nbrowserConfig: {}`;
            }
            return `id: CASE-B01\nname: Scenario B inbox\nurl: http://localhost:15174/scenario-b/mock-exam/inbox\nsteps: []\nbrowserConfig: {}`;
        });
    });

    it('imports/updates cases and syncs runtime env configs', async () => {
        const request = new Request('http://localhost/api/projects/project-1/test-cases/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ root: '/tmp/sample-workspace' }),
        });

        const response = await POST(request, {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.loadRuntimeConfigForCwd).toHaveBeenCalledWith('/tmp/sample-workspace');
        expect(mocks.loadTestCatalog).toHaveBeenCalledWith('/tmp/sample-workspace');
        expect(mocks.testCaseUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.testCaseCreate).toHaveBeenCalledTimes(1);
        expect(mocks.projectConfigUpsert).toHaveBeenCalledTimes(1);
        expect(payload).toEqual({
            imported: 1,
            updated: 1,
            runtimeConfigsSynced: 1,
            root: '/tmp/sample-workspace',
        });
    });

    it('returns validation error when root cannot be resolved', async () => {
        mocks.testCaseFindMany.mockResolvedValueOnce([
            { source: 'agent' },
        ]);

        const request = new Request('http://localhost/api/projects/project-1/test-cases/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });

        const response = await POST(request, {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload).toMatchObject({
            code: 'VALIDATION_ERROR',
        });
    });

    it('rejects non-absolute catalog roots', async () => {
        const request = new Request('http://localhost/api/projects/project-1/test-cases/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ root: './relative' }),
        });

        const response = await POST(request, {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload).toMatchObject({
            code: 'VALIDATION_ERROR',
            error: 'Catalog root must be an absolute path',
        });
    });

    it('rejects roots that do not contain a .skytest directory', async () => {
        mocks.existsSync.mockReturnValueOnce(false);
        const request = new Request('http://localhost/api/projects/project-1/test-cases/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ root: '/tmp/sample-workspace' }),
        });

        const response = await POST(request, {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload).toMatchObject({
            code: 'VALIDATION_ERROR',
            error: 'Catalog root must contain a .skytest directory',
        });
    });
});
