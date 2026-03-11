import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runTest: vi.fn(),
    resolveConfigs: vi.fn(),
    decrypt: vi.fn(),
    publishRunUpdate: vi.fn(),
    testRunFindUnique: vi.fn(),
    testRunFindFirst: vi.fn(),
    testRunUpdateMany: vi.fn(),
    testCaseUpdate: vi.fn(),
    userFindUnique: vi.fn(),
    projectFindUnique: vi.fn(),
    usageRecordUpsert: vi.fn(),
    usageRecordCreate: vi.fn(),
}));

vi.mock('@/lib/runtime/test-runner', () => ({
    runTest: mocks.runTest,
}));

vi.mock('@/lib/config/resolver', () => ({
    resolveConfigs: mocks.resolveConfigs,
}));

vi.mock('@/lib/security/crypto', () => ({
    decrypt: mocks.decrypt,
}));

vi.mock('@/lib/runners/event-bus', () => ({
    publishRunUpdate: mocks.publishRunUpdate,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findUnique: mocks.testRunFindUnique,
            findFirst: mocks.testRunFindFirst,
            updateMany: mocks.testRunUpdateMany,
        },
        testCase: {
            update: mocks.testCaseUpdate,
        },
        user: {
            findUnique: mocks.userFindUnique,
        },
        project: {
            findUnique: mocks.projectFindUnique,
        },
        usageRecord: {
            upsert: mocks.usageRecordUpsert,
            create: mocks.usageRecordCreate,
        },
        testRunEvent: {
            createMany: vi.fn(),
        },
        testRunFile: {
            create: vi.fn(),
        },
        $transaction: vi.fn(),
    }
}));

const { startLocalBrowserRun } = await import('@/lib/runtime/local-browser-runner');

describe('local-browser-runner usage recording', () => {
    beforeEach(() => {
        mocks.runTest.mockReset();
        mocks.resolveConfigs.mockReset();
        mocks.decrypt.mockReset();
        mocks.publishRunUpdate.mockReset();
        mocks.testRunFindUnique.mockReset();
        mocks.testRunFindFirst.mockReset();
        mocks.testRunUpdateMany.mockReset();
        mocks.testCaseUpdate.mockReset();
        mocks.userFindUnique.mockReset();
        mocks.projectFindUnique.mockReset();
        mocks.usageRecordUpsert.mockReset();
        mocks.usageRecordCreate.mockReset();

        mocks.resolveConfigs.mockResolvedValue({ variables: {}, files: {} });
        mocks.decrypt.mockReturnValue('sk-test');
        mocks.runTest.mockResolvedValue({ status: 'PASS', actionCount: 7 });
        mocks.testRunFindUnique.mockResolvedValue({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'RUNNING',
            assignedRunnerId: null,
            leaseExpiresAt: null,
            configurationSnapshot: null,
            files: [],
            testCase: {
                id: 'tc-1',
                name: 'Checkout flow',
                url: 'https://example.com',
                prompt: null,
                steps: null,
                browserConfig: null,
                projectId: 'project-1',
                project: {
                    name: 'Shop',
                    createdByUserId: 'user-1',
                    team: {
                        openRouterKeyEncrypted: 'encrypted',
                    }
                }
            }
        });
        mocks.testRunFindFirst.mockResolvedValue({ id: 'run-1' });
        mocks.testRunUpdateMany.mockResolvedValue({ count: 1 });
        mocks.testCaseUpdate.mockResolvedValue({ id: 'tc-1', status: 'PASS' });
        mocks.userFindUnique.mockResolvedValue({ id: 'user-1' });
        mocks.projectFindUnique.mockResolvedValue({ id: 'project-1' });
        mocks.usageRecordUpsert.mockResolvedValue({ id: 'usage-1' });
    });

    it('records usage for completed local runs', async () => {
        await startLocalBrowserRun('run-1');

        expect(mocks.usageRecordUpsert).toHaveBeenCalledWith({
            where: { testRunId: 'run-1' },
            update: {
                actorUserId: 'user-1',
                projectId: 'project-1',
                type: 'TEST_RUN',
                description: 'Shop - Checkout flow',
                aiActions: 7,
            },
            create: {
                actorUserId: 'user-1',
                projectId: 'project-1',
                type: 'TEST_RUN',
                description: 'Shop - Checkout flow',
                aiActions: 7,
                testRunId: 'run-1',
            }
        });
    });
});
