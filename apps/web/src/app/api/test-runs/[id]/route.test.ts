import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Covers the login-flow prefix list, which tells a queued test which login flows it is waiting on.
 * A retried group re-runs its login flows, so this list is one of the members lists that has to
 * reduce to the latest attempt per case — otherwise the same flow appears twice and an
 * already-superseded failure is reported as the current reason the test has not started.
 */
const mocks = vi.hoisted(() => ({
    guardTestRunRouteRequest: vi.fn(),
    testRunFindUnique: vi.fn(),
    testRunFindMany: vi.fn(),
    testRunEventFindMany: vi.fn(),
    loadMaskedVariableValuesForTestCase: vi.fn(),
}));

vi.mock('@/lib/security/test-run-route-access', () => ({
    guardTestRunRouteRequest: mocks.guardTestRunRouteRequest,
}));
vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: { findUnique: mocks.testRunFindUnique, findMany: mocks.testRunFindMany },
        testRunEvent: { findMany: mocks.testRunEventFindMany },
    },
}));
vi.mock('@/lib/runtime/masked-variables', () => ({
    loadMaskedVariableValuesForTestCase: mocks.loadMaskedVariableValuesForTestCase,
}));
vi.mock('@/lib/storage/object-store', () => ({
    objectStore: { getSignedUrl: vi.fn(async () => null), get: vi.fn(async () => null) },
}));

const { GET } = await import('@/app/api/test-runs/[id]/route');

const params = Promise.resolve({ id: 'run-1' });
const makeRequest = () => new Request('http://localhost/api/test-runs/run-1');

function prefixRow(options: { id: string; testCaseId: string; attempt: number; status: string; position: number }) {
    return {
        id: options.id,
        status: options.status,
        testCaseId: options.testCaseId,
        attempt: options.attempt,
        sessionPosition: options.position,
        testCase: { displayId: options.testCaseId.toUpperCase(), name: options.testCaseId },
    };
}

/** A queued session member at position 2, so the two login flows before it are its prefixes. */
function baseRun(overrides: Record<string, unknown> = {}) {
    return {
        id: 'run-1',
        status: 'QUEUED',
        runSessionId: 'session-1',
        sessionPosition: 2,
        deletedAt: null,
        result: null,
        error: null,
        events: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        startedAt: null,
        completedAt: null,
        files: [],
        testCase: {
            id: 'case-1',
            projectId: 'project-1',
            displayId: 'C1',
            name: 'Case One',
            url: 'https://example.com',
            prompt: null,
            steps: null,
            browserConfig: null,
            project: { name: 'Project One', teamId: 'team-1' },
        },
        ...overrides,
    };
}

describe('GET /api/test-runs/[id] login flow prefixes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.guardTestRunRouteRequest.mockResolvedValue({ ok: true, params: { id: 'run-1' }, userId: 'user-1' });
        mocks.loadMaskedVariableValuesForTestCase.mockResolvedValue([]);
        mocks.testRunEventFindMany.mockResolvedValue([]);
        mocks.testRunFindUnique.mockResolvedValue(baseRun());
    });

    it('lists a re-run login flow once, at its latest attempt', async () => {
        mocks.testRunFindMany.mockResolvedValue([
            prefixRow({ id: 'login-a1', testCaseId: 'login', attempt: 1, status: 'FAIL', position: 0 }),
            prefixRow({ id: 'login-a2', testCaseId: 'login', attempt: 2, status: 'PASS', position: 0 }),
        ]);

        const payload = await (await GET(makeRequest(), { params })).json();

        expect(payload.loginFlowPrefixes).toEqual([
            expect.objectContaining({ runId: 'login-a2', testCaseId: 'login', status: 'PASS' }),
        ]);
    });

    it('keeps every distinct login flow, in session order', async () => {
        mocks.testRunFindMany.mockResolvedValue([
            prefixRow({ id: 'first-1', testCaseId: 'first', attempt: 1, status: 'PASS', position: 0 }),
            prefixRow({ id: 'second-1', testCaseId: 'second', attempt: 1, status: 'FAIL', position: 1 }),
            prefixRow({ id: 'second-2', testCaseId: 'second', attempt: 2, status: 'PASS', position: 1 }),
        ]);

        const payload = await (await GET(makeRequest(), { params })).json();

        expect(payload.loginFlowPrefixes.map((flow: { runId: string }) => flow.runId))
            .toEqual(['first-1', 'second-2']);
    });

    it('reports no prefixes for a run outside a session', async () => {
        mocks.testRunFindUnique.mockResolvedValue(baseRun({ runSessionId: null, sessionPosition: null }));

        const payload = await (await GET(makeRequest(), { params })).json();

        expect(payload.loginFlowPrefixes).toEqual([]);
        expect(mocks.testRunFindMany).not.toHaveBeenCalled();
    });
});
