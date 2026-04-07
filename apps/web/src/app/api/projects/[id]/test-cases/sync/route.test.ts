import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveUserId: vi.fn(),
    isProjectMember: vi.fn(),
    projectFindUnique: vi.fn(),
    testCaseFindFirst: vi.fn(),
    testCaseFindMany: vi.fn(),
    testCaseUpdate: vi.fn(),
    testCaseCreate: vi.fn(),
    projectConfigUpsert: vi.fn(),
    loadRuntimeConfigForCwd: vi.fn(),
    loadTestCatalog: vi.fn(),
    readFile: vi.fn(),
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
            findFirst: mocks.testCaseFindFirst,
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
        mocks.testCaseFindFirst.mockResolvedValue({ source: '/tmp/hanlun/.skytest/tests/student/HAN-C02.case.yaml' });
        mocks.testCaseFindMany.mockResolvedValue([
            { id: 'tc-existing', displayId: 'HAN-C02', status: 'DRAFT' },
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
                    STUDENT_EMAIL: 'student@example.com',
                },
            },
        });
        mocks.loadTestCatalog.mockResolvedValue(new Map([
            ['HAN-C02', { id: 'HAN-C02', sourcePath: '/tmp/hanlun/.skytest/tests/student/HAN-C02.case.yaml', sourceHash: 'hash-a' }],
            ['HAN-T01', { id: 'HAN-T01', sourcePath: '/tmp/hanlun/.skytest/tests/teacher/HAN-T01.case.yaml', sourceHash: 'hash-b' }],
        ]));
        mocks.readFile.mockImplementation(async (sourcePath: string) => {
            if (sourcePath.includes('HAN-C02')) {
                return `id: HAN-C02\nname: Student baseline\nurl: http://localhost:15173/mock-exam/dashboard\nsteps: []\nbrowserConfig: {}`;
            }
            return `id: HAN-T01\nname: Teacher inbox\nurl: http://localhost:15174/teacher/mock-exam/inbox\nsteps: []\nbrowserConfig: {}`;
        });
    });

    it('imports/updates cases and syncs runtime env configs', async () => {
        const request = new Request('http://localhost/api/projects/project-1/test-cases/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ root: '/tmp/hanlun' }),
        });

        const response = await POST(request, {
            params: Promise.resolve({ id: 'project-1' }),
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.loadRuntimeConfigForCwd).toHaveBeenCalledWith('/tmp/hanlun');
        expect(mocks.loadTestCatalog).toHaveBeenCalledWith('/tmp/hanlun');
        expect(mocks.testCaseUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.testCaseCreate).toHaveBeenCalledTimes(1);
        expect(mocks.projectConfigUpsert).toHaveBeenCalledTimes(1);
        expect(payload).toEqual({
            imported: 1,
            updated: 1,
            runtimeConfigsSynced: 1,
            root: '/tmp/hanlun',
        });
    });

    it('returns validation error when root cannot be resolved', async () => {
        mocks.testCaseFindFirst.mockResolvedValue(null);

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
});
