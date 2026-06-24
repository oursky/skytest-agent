import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runProject } from './run-project';

describe('runProject auto-sync behavior', () => {
    const fetchMock = vi.fn();
    const originalFetch = global.fetch;

    beforeEach(() => {
        vi.resetAllMocks();
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('auto-syncs once before listing and dispatching', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 0, updated: 2 }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify([
                { id: 'tc-1', displayId: 'CASE-A02', name: 'Scenario A baseline' },
            ]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify([
                { id: 'tc-1', displayId: 'CASE-A02', name: 'Scenario A baseline' },
            ]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                id: 'tc-1',
                displayId: 'CASE-A02',
                name: 'Scenario A baseline',
                url: 'http://localhost:15173',
                prompt: null,
                steps: [],
                browserConfig: {},
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                runId: 'run-1',
                status: 'QUEUED',
                requiredCapability: 'BROWSER',
            }), { status: 200 }));

        const summary = await runProject({
            projectId: 'project-1',
            displayIds: ['CASE-A02'],
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            authToken: 'sk_test_abc',
            wait: false,
            timeoutMs: 6000,
            reporter: 'console',
            format: 'json',
        });

        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3000/api/projects/project-1/test-cases/sync');
        expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:3000/api/projects/project-1/test-cases');
        expect(summary).toEqual({
            projectId: 'project-1',
            wait: false,
            runCount: 1,
            results: [
                {
                    displayId: 'CASE-A02',
                    runId: 'run-1',
                    status: 'QUEUED',
                    error: null,
                },
            ],
        });
    });

    it('skips sync endpoint when syncBeforeRun=false', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify([
                { id: 'tc-1', displayId: 'CASE-A02', name: 'Scenario A baseline' },
            ]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify([
                { id: 'tc-1', displayId: 'CASE-A02', name: 'Scenario A baseline' },
            ]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                id: 'tc-1',
                displayId: 'CASE-A02',
                name: 'Scenario A baseline',
                url: 'http://localhost:15173',
                prompt: null,
                steps: [],
                browserConfig: {},
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                runId: 'run-1',
                status: 'QUEUED',
                requiredCapability: 'BROWSER',
            }), { status: 200 }));

        await runProject({
            projectId: 'project-1',
            displayIds: ['CASE-A02'],
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            authToken: 'sk_test_abc',
            syncBeforeRun: false,
            wait: false,
            timeoutMs: 6000,
            reporter: 'console',
            format: 'json',
        });

        expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3000/api/projects/project-1/test-cases');
    });

    it('skips login flows when running every case in the project', async () => {
        let loginFlowDispatched = false;

        fetchMock.mockImplementation(async (input) => {
            const url = String(input);

            if (url.endsWith('/api/projects/project-1/test-cases/sync')) {
                return new Response(JSON.stringify({ imported: 0, updated: 0 }), { status: 200 });
            }

            if (url.endsWith('/api/projects/project-1/test-cases')) {
                return new Response(JSON.stringify([
                    { id: 'tc-1', displayId: 'CASE-T01', name: 'A real test', kind: 'TEST' },
                    { id: 'lf-1', displayId: 'LOGIN-01', name: 'Admin login', kind: 'LOGIN_FLOW' },
                ]), { status: 200 });
            }

            if (url.endsWith('/api/test-cases/tc-1')) {
                return new Response(JSON.stringify({
                    id: 'tc-1', displayId: 'CASE-T01', name: 'A real test',
                    url: 'http://localhost:15173', prompt: null, steps: [], browserConfig: {},
                }), { status: 200 });
            }

            if (url.endsWith('/api/test-cases/lf-1')) {
                loginFlowDispatched = true;
                throw new Error('Login flow should never be fetched for a standalone run');
            }

            if (url.endsWith('/api/test-runs/dispatch')) {
                return new Response(JSON.stringify({ runId: 'run-1', status: 'QUEUED', requiredCapability: 'BROWSER' }), { status: 200 });
            }

            throw new Error(`Unexpected mocked URL: ${url}`);
        });

        const summary = await runProject({
            projectId: 'project-1',
            displayIds: [],
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            authToken: 'sk_test_abc',
            wait: false,
            timeoutMs: 6000,
            reporter: 'console',
            format: 'json',
        });

        expect(summary.results.map((result) => result.displayId)).toEqual(['CASE-T01']);
        expect(loginFlowDispatched).toBe(false);
    });

    it('rejects an explicitly requested login flow', async () => {
        fetchMock.mockImplementation(async (input) => {
            const url = String(input);

            if (url.endsWith('/api/projects/project-1/test-cases/sync')) {
                return new Response(JSON.stringify({ imported: 0, updated: 0 }), { status: 200 });
            }

            if (url.endsWith('/api/projects/project-1/test-cases')) {
                return new Response(JSON.stringify([
                    { id: 'lf-1', displayId: 'LOGIN-01', name: 'Admin login', kind: 'LOGIN_FLOW' },
                ]), { status: 200 });
            }

            throw new Error(`Unexpected mocked URL: ${url}`);
        });

        await expect(runProject({
            projectId: 'project-1',
            displayIds: ['LOGIN-01'],
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            authToken: 'sk_test_abc',
            wait: false,
            timeoutMs: 6000,
            reporter: 'console',
            format: 'json',
        })).rejects.toThrow(/login flows, not standalone tests/);
    });

    it('runs multiple cases with bounded concurrency and keeps display-id order in summary', async () => {
        const runIds: string[] = [];
        let syncCalled = false;
        let dispatchCount = 0;

        fetchMock.mockImplementation(async (input) => {
            const url = String(input);

            if (url.endsWith('/api/projects/project-1/test-cases/sync')) {
                syncCalled = true;
                return new Response(JSON.stringify({ imported: 0, updated: 2 }), { status: 200 });
            }

            if (url.endsWith('/api/projects/project-1/test-cases')) {
                return new Response(JSON.stringify([
                    { id: 'tc-1', displayId: 'CASE-C02', name: 'Case A' },
                    { id: 'tc-2', displayId: 'CASE-T01', name: 'Case B' },
                ]), { status: 200 });
            }

            if (url.endsWith('/api/test-cases/tc-1')) {
                return new Response(JSON.stringify({
                    id: 'tc-1',
                    displayId: 'CASE-C02',
                    name: 'Case A',
                    url: 'http://localhost:15173',
                    prompt: null,
                    steps: [],
                    browserConfig: {},
                }), { status: 200 });
            }

            if (url.endsWith('/api/test-cases/tc-2')) {
                return new Response(JSON.stringify({
                    id: 'tc-2',
                    displayId: 'CASE-T01',
                    name: 'Case B',
                    url: 'http://localhost:15174',
                    prompt: null,
                    steps: [],
                    browserConfig: {},
                }), { status: 200 });
            }

            if (url.endsWith('/api/test-runs/dispatch')) {
                dispatchCount += 1;
                const runId = dispatchCount === 1 ? 'run-1' : 'run-2';
                runIds.push(runId);
                return new Response(JSON.stringify({ runId, status: 'QUEUED', requiredCapability: 'BROWSER' }), { status: 200 });
            }

            throw new Error(`Unexpected mocked URL: ${url}`);
        });

        const summary = await runProject({
            projectId: 'project-1',
            displayIds: ['CASE-C02', 'CASE-T01'],
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            authToken: 'sk_test_abc',
            wait: false,
            timeoutMs: 6000,
            reporter: 'console',
            format: 'json',
            concurrency: 2,
        });

        expect(summary.results.map((result) => result.displayId)).toEqual(['CASE-C02', 'CASE-T01']);
        expect(syncCalled).toBe(true);
        expect(runIds.sort()).toEqual(['run-1', 'run-2']);
    });
});
