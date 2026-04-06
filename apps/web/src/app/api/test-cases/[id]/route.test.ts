import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    guardTestCaseRouteRequest: vi.fn(),
    loadTestCatalog: vi.fn(),
    writeCatalogCaseFile: vi.fn(),
    parseTestCaseJson: vi.fn(),
    cleanStepsForStorage: vi.fn(),
    normalizeTargetConfigMap: vi.fn(),
    readFile: vi.fn(),
    dumpYaml: vi.fn(),
    parseYaml: vi.fn(),
    prisma: {
        testCase: {
            findUnique: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        },
    },
}));

vi.mock('node:fs/promises', () => ({
    readFile: mocks.readFile,
}));

vi.mock('js-yaml', () => ({
    dump: mocks.dumpYaml,
    load: mocks.parseYaml,
}));

vi.mock('@/lib/security/test-case-route-access', () => ({
    guardTestCaseRouteRequest: mocks.guardTestCaseRouteRequest,
}));

vi.mock('@/lib/test-cases/catalog-loader', () => ({
    loadTestCatalog: mocks.loadTestCatalog,
}));

vi.mock('@/lib/test-cases/catalog-writeback', () => ({
    writeCatalogCaseFile: mocks.writeCatalogCaseFile,
}));

vi.mock('@/lib/runtime/test-case-utils', () => ({
    parseTestCaseJson: mocks.parseTestCaseJson,
    cleanStepsForStorage: mocks.cleanStepsForStorage,
    normalizeTargetConfigMap: mocks.normalizeTargetConfigMap,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: mocks.prisma,
}));

const { PUT } = await import('@/app/api/test-cases/[id]/route');

describe('PUT /api/test-cases/[id]', () => {
    const testCaseId = 'tc_123';
    const sourcePath = '/tmp/case-study/HAN-C02.case.yaml';

    beforeEach(() => {
        mocks.guardTestCaseRouteRequest.mockReset();
        mocks.loadTestCatalog.mockReset();
        mocks.writeCatalogCaseFile.mockReset();
        mocks.parseTestCaseJson.mockReset();
        mocks.cleanStepsForStorage.mockReset();
        mocks.normalizeTargetConfigMap.mockReset();
        mocks.readFile.mockReset();
        mocks.dumpYaml.mockReset();
        mocks.parseYaml.mockReset();

        mocks.prisma.testCase.findUnique.mockReset();
        mocks.prisma.testCase.update.mockReset();
        mocks.prisma.testCase.delete.mockReset();

        mocks.guardTestCaseRouteRequest.mockResolvedValue({
            ok: true,
            testCaseId,
        });

        mocks.prisma.testCase.findUnique.mockResolvedValue({
            id: testCaseId,
            source: sourcePath,
            sourceHash: 'db-hash',
            files: [],
            configs: [],
        });

        mocks.loadTestCatalog.mockResolvedValue(
            new Map([
                [
                    'HAN-C02',
                    {
                        id: 'HAN-C02',
                        sourcePath,
                        sourceHash: 'catalog-hash',
                    },
                ],
            ])
        );

        mocks.readFile.mockResolvedValue('id: HAN-C02\nname: Existing\nurl: http://localhost\n');
        mocks.parseYaml.mockReturnValue({
            id: 'HAN-C02',
            name: 'Existing',
            url: 'http://localhost',
            prompt: '',
            steps: [],
            browserConfig: {},
        });
        mocks.dumpYaml.mockReturnValue('id: HAN-C02\nname: Updated\nurl: http://localhost\n');
        mocks.writeCatalogCaseFile.mockResolvedValue({ sourceHash: 'new-hash' });

        mocks.prisma.testCase.update.mockResolvedValue({
            id: testCaseId,
            displayId: 'HAN-C02',
            source: sourcePath,
            sourceHash: 'new-hash',
        });
    });

    it('uses DB sourceHash as expectedHash when expectedHash is omitted', async () => {
        const request = new Request('http://localhost/api/test-cases/tc_123', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                displayId: 'HAN-C02',
                name: 'Updated',
                url: 'http://localhost',
                prompt: '',
                steps: [],
                browserConfig: {},
            }),
        });

        const response = await PUT(request, {
            params: Promise.resolve({ id: testCaseId }),
        });

        expect(response.status).toBe(200);
        expect(mocks.writeCatalogCaseFile).toHaveBeenCalledWith(
            expect.objectContaining({
                sourcePath,
                expectedHash: 'db-hash',
            })
        );
    });

    it('updates source-backed test case without requiring runtime catalog from process cwd', async () => {
        mocks.loadTestCatalog.mockImplementation(() => {
            throw new Error('loadTestCatalog should not be called for source-backed updates');
        });

        const request = new Request('http://localhost/api/test-cases/tc_123', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                displayId: 'HAN-C02',
                name: 'Updated',
                url: 'http://localhost',
                prompt: '',
                steps: [],
                browserConfig: {},
            }),
        });

        const response = await PUT(request, {
            params: Promise.resolve({ id: testCaseId }),
        });

        expect(response.status).toBe(200);
        expect(mocks.writeCatalogCaseFile).toHaveBeenCalledWith(
            expect.objectContaining({ sourcePath })
        );
    });
});
