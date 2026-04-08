import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTestCase } from './run-test-case';

describe('runTestCase auto-sync behavior', () => {
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

    it('auto-syncs before resolving and dispatching a test case', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 0, updated: 1 }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify([
                { id: 'tc-1', displayId: 'CASE-A02', name: 'Scenario A baseline', url: 'http://localhost:15173', prompt: null, steps: [], browserConfig: {} },
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

        const summary = await runTestCase({
            displayId: 'CASE-A02',
            projectId: 'project-1',
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            authToken: 'sk_test_abc',
            wait: false,
            timeoutMs: 6000,
            reporter: 'console',
            format: 'json',
        });

        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3000/api/projects/project-1/test-cases/sync');
        expect(summary).toEqual({
            displayId: 'CASE-A02',
            projectId: 'project-1',
            runId: 'run-1',
            status: 'QUEUED',
            wait: false,
        });
    });

    it('skips sync endpoint when syncBeforeRun=false', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify([
                { id: 'tc-1', displayId: 'CASE-A02', name: 'Scenario A baseline', url: 'http://localhost:15173', prompt: null, steps: [], browserConfig: {} },
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

        await runTestCase({
            displayId: 'CASE-A02',
            projectId: 'project-1',
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
});
