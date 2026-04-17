import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, resolveConfigs } = vi.hoisted(() => ({
    findUnique: vi.fn(),
    resolveConfigs: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findUnique,
        },
    },
}));

vi.mock('@/lib/test-config/resolver', () => ({
    resolveConfigs,
}));

vi.mock('@/lib/security/crypto', () => ({
    decrypt: vi.fn(() => 'decrypted-key'),
}));

const { loadRunnerJobDetails } = await import('@/lib/runners/job-details-service');

describe('loadRunnerJobDetails', () => {
    beforeEach(() => {
        findUnique.mockReset();
        resolveConfigs.mockReset();
        resolveConfigs.mockResolvedValue({
            variables: { env: 'staging' },
            files: { report: 'reports/latest.txt' },
            allConfigs: [],
        });
    });

    it('returns run details for an owned active lease', async () => {
        findUnique.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'PREPARING',
            configurationSnapshot: JSON.stringify({
                url: 'https://example.com',
                prompt: 'Run',
                steps: [{ id: 's1', target: 'main', action: 'Click' }],
                browserConfig: { main: { type: 'browser', url: 'https://example.com', width: 1280, height: 800 } },
            }),
            assignedRunnerId: 'runner-1',
            leaseExpiresAt: new Date(Date.now() + 60_000),
            files: [
                { id: 'f1', filename: 'input.txt', storedName: 'x', mimeType: 'text/plain', size: 12 },
            ],
            testCase: {
                id: 'tc-1',
                url: 'https://fallback.com',
                prompt: null,
                steps: null,
                browserConfig: null,
                projectId: 'project-1',
                project: {
                    team: {
                        openRouterKeyEncrypted: 'encrypted',
                    },
                },
            },
        });

        const result = await loadRunnerJobDetails({
            runId: 'run-1',
            runnerId: 'runner-1',
        });

        expect(result).toEqual({
            runId: 'run-1',
            testCaseId: 'tc-1',
            projectId: 'project-1',
            config: {
                url: 'https://example.com',
                prompt: 'Run',
                steps: [{ id: 's1', target: 'main', action: 'Click' }],
                browserConfig: { main: { type: 'browser', url: 'https://example.com', width: 1280, height: 800 } },
                openRouterApiKey: 'decrypted-key',
                aiProvider: 'openrouter',
                files: [{ id: 'f1', filename: 'input.txt', storedName: 'x', mimeType: 'text/plain', size: 12 }],
                resolvedVariables: { env: 'staging' },
                resolvedFiles: { report: 'reports/latest.txt' },
            },
        });
    });

    it('returns null for non-owned runs', async () => {
        findUnique.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'PREPARING',
            configurationSnapshot: null,
            assignedRunnerId: 'runner-2',
            leaseExpiresAt: new Date(Date.now() + 60_000),
            files: [],
            testCase: {
                id: 'tc-1',
                url: 'https://example.com',
                prompt: null,
                steps: null,
                browserConfig: null,
                projectId: 'project-1',
                project: {
                    team: {
                        openRouterKeyEncrypted: 'encrypted',
                    },
                },
            },
        });

        const result = await loadRunnerJobDetails({
            runId: 'run-1',
            runnerId: 'runner-1',
        });

        expect(result).toBeNull();
    });

    it('uses resolved configurations from snapshot when available', async () => {
        findUnique.mockResolvedValueOnce({
            id: 'run-2',
            testCaseId: 'tc-1',
            status: 'RUNNING',
            configurationSnapshot: JSON.stringify({
                url: 'https://example.com',
                resolvedConfigurations: [
                    {
                        name: 'ENV',
                        type: 'VARIABLE',
                        value: 'staging',
                        source: 'project',
                    },
                    {
                        name: 'seedCsv',
                        type: 'FILE',
                        value: 'objects/seed.csv',
                        filename: 'seed.csv',
                        source: 'test-case',
                    },
                ],
            }),
            assignedRunnerId: 'runner-1',
            leaseExpiresAt: new Date(Date.now() + 60_000),
            files: [],
            testCase: {
                id: 'tc-1',
                url: 'https://fallback.com',
                prompt: null,
                steps: null,
                browserConfig: null,
                projectId: 'project-1',
                project: {
                    team: {
                        openRouterKeyEncrypted: 'encrypted',
                    },
                },
            },
        });

        const result = await loadRunnerJobDetails({
            runId: 'run-2',
            runnerId: 'runner-1',
        });

        expect(resolveConfigs).not.toHaveBeenCalled();
        expect(result?.config.resolvedVariables).toEqual({ ENV: 'staging' });
        expect(result?.config.resolvedFiles).toEqual({
            seedCsv: 'objects/seed.csv',
            'seed.csv': 'objects/seed.csv',
        });
    });

    it('includes team AI provider and model options in job details config', async () => {
        findUnique.mockResolvedValueOnce({
            id: 'run-3',
            testCaseId: 'tc-1',
            status: 'RUNNING',
            configurationSnapshot: JSON.stringify({
                url: 'https://example.com',
            }),
            assignedRunnerId: 'runner-1',
            leaseExpiresAt: new Date(Date.now() + 60_000),
            files: [],
            testCase: {
                id: 'tc-1',
                url: 'https://fallback.com',
                prompt: null,
                steps: null,
                browserConfig: null,
                projectId: 'project-1',
                project: {
                    team: {
                        openRouterKeyEncrypted: 'encrypted',
                        aiProvider: 'OPENROUTER',
                        aiBaseUrl: 'https://openrouter.ai/api/v1',
                        aiMainModel: 'qwen/qwen3.5-27b',
                        aiMainModelFamily: 'qwen3.5',
                        aiPlanningModel: 'qwen/qwen3.5-27b',
                        aiPlanningModelFamily: 'qwen3.5',
                        aiInsightModel: 'qwen/qwen3.5-27b',
                        aiInsightModelFamily: 'qwen3.5',
                        aiTemperature: 0.2,
                    },
                },
            },
        });

        const result = await loadRunnerJobDetails({
            runId: 'run-3',
            runnerId: 'runner-1',
        });

        expect(result).toMatchObject({
            config: {
                aiProvider: 'openrouter',
                midsceneModelOptions: {
                    baseUrl: 'https://openrouter.ai/api/v1',
                    mainModel: 'qwen/qwen3.5-27b',
                    mainModelFamily: 'qwen3.5',
                    planningModel: 'qwen/qwen3.5-27b',
                    planningModelFamily: 'qwen3.5',
                    insightModel: 'qwen/qwen3.5-27b',
                    insightModelFamily: 'qwen3.5',
                    temperature: 0.2,
                },
            },
        });
    });
});
