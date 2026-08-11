import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    guardProjectRouteRequest: vi.fn(),
    runSessionFindFirst: vi.fn(),
    runSessionFindUnique: vi.fn(),
    cancelActiveRunSession: vi.fn(),
}));

vi.mock('@/lib/security/project-route-access', () => ({
    guardProjectRouteRequest: mocks.guardProjectRouteRequest,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        runSession: {
            findFirst: mocks.runSessionFindFirst,
            findUnique: mocks.runSessionFindUnique,
        },
    },
}));

vi.mock('@/lib/runtime/cancel-run', () => ({
    cancelActiveRunSession: mocks.cancelActiveRunSession,
}));

const { GET, POST } = await import('@/app/api/projects/[id]/run-sessions/[sessionId]/route');

const params = Promise.resolve({ id: 'project-1', sessionId: 'session-1' });
const makeRequest = () => new Request('http://localhost/api/projects/project-1/run-sessions/session-1', { method: 'POST' });
const makeGetRequest = () => new Request('http://localhost/api/projects/project-1/run-sessions/session-1');

/** One attempt row as the route selects it. */
function memberRun(options: {
    id: string;
    testCaseId: string;
    attempt: number;
    sessionPosition: number;
    status: string;
    kind?: string;
}) {
    return {
        id: options.id,
        testCaseId: options.testCaseId,
        kind: options.kind ?? 'TEST',
        sessionPosition: options.sessionPosition,
        attempt: options.attempt,
        status: options.status,
        reusedSession: false,
        startedAt: new Date('2026-01-01T00:00:00Z'),
        completedAt: new Date('2026-01-01T00:01:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        testCase: { displayId: options.testCaseId.toUpperCase(), name: options.testCaseId },
    };
}

describe('POST /api/projects/[id]/run-sessions/[sessionId]', () => {
    beforeEach(() => {
        mocks.guardProjectRouteRequest.mockReset();
        mocks.runSessionFindFirst.mockReset();
        mocks.runSessionFindUnique.mockReset();
        mocks.cancelActiveRunSession.mockReset();

        mocks.guardProjectRouteRequest.mockResolvedValue({ ok: true, params: { id: 'project-1', sessionId: 'session-1' }, userId: 'user-1' });
        mocks.runSessionFindFirst.mockResolvedValue({ id: 'session-1' });
        mocks.cancelActiveRunSession.mockResolvedValue({ cancelledMembers: 2 });
        mocks.runSessionFindUnique.mockResolvedValue({ status: 'CANCELLED' });
    });

    it('cancels the whole session and returns the rolled-up status', async () => {
        const response = await POST(makeRequest(), { params });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.runSessionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'session-1', projectId: 'project-1' },
        }));
        expect(mocks.cancelActiveRunSession).toHaveBeenCalledWith('session-1');
        expect(payload).toMatchObject({ success: true, id: 'session-1', status: 'CANCELLED', cancelledMembers: 2 });
    });

    it('returns 404 when the session is not in the project', async () => {
        mocks.runSessionFindFirst.mockResolvedValue(null);

        const response = await POST(makeRequest(), { params });

        expect(response.status).toBe(404);
        expect(mocks.cancelActiveRunSession).not.toHaveBeenCalled();
    });

    it('returns the guard response when access is denied', async () => {
        mocks.guardProjectRouteRequest.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });

        const response = await POST(makeRequest(), { params });

        expect(response.status).toBe(403);
        expect(mocks.runSessionFindFirst).not.toHaveBeenCalled();
    });
});

describe('GET /api/projects/[id]/run-sessions/[sessionId]', () => {
    beforeEach(() => {
        mocks.guardProjectRouteRequest.mockReset();
        mocks.runSessionFindFirst.mockReset();
        mocks.guardProjectRouteRequest.mockResolvedValue({ ok: true, params: { id: 'project-1', sessionId: 'session-1' }, userId: 'user-1' });
    });

    function seedSession(memberRuns: ReturnType<typeof memberRun>[], retryPolicy = 'FAILED_ONCE') {
        mocks.runSessionFindFirst.mockResolvedValue({
            id: 'session-1',
            kind: 'GROUP',
            status: 'PASS',
            testGroupId: 'group-1',
            retryPolicy,
            startedAt: new Date('2026-01-01T00:00:00Z'),
            completedAt: new Date('2026-01-01T00:05:00Z'),
            createdAt: new Date('2026-01-01T00:00:00Z'),
            project: { name: 'Project One' },
            testGroup: { name: 'Group One', onFailure: 'STOP', executionMode: 'SEQUENTIAL' },
            memberRuns,
        });
    }

    it('lists a retried case once, as its final attempt', async () => {
        seedSession([
            memberRun({ id: 'a1', testCaseId: 'a', attempt: 1, sessionPosition: 0, status: 'PASS' }),
            memberRun({ id: 'b1', testCaseId: 'b', attempt: 1, sessionPosition: 1, status: 'FAIL' }),
            memberRun({ id: 'b2', testCaseId: 'b', attempt: 2, sessionPosition: 1, status: 'PASS' }),
        ]);

        const payload = await (await GET(makeGetRequest(), { params })).json();

        expect(payload.members).toHaveLength(2);
        expect(payload.members.map((member: { runId: string; status: string }) => [member.runId, member.status]))
            .toEqual([['a1', 'PASS'], ['b2', 'PASS']]);
        expect(payload.retryPolicy).toBe('FAILED_ONCE');
    });

    it('keeps the superseded attempts reachable on the case that was retried', async () => {
        seedSession([
            memberRun({ id: 'b1', testCaseId: 'b', attempt: 1, sessionPosition: 0, status: 'FAIL' }),
            memberRun({ id: 'b2', testCaseId: 'b', attempt: 2, sessionPosition: 0, status: 'FAIL' }),
            memberRun({ id: 'b3', testCaseId: 'b', attempt: 3, sessionPosition: 0, status: 'PASS' }),
        ]);

        const payload = await (await GET(makeGetRequest(), { params })).json();

        expect(payload.members).toHaveLength(1);
        expect(payload.members[0]).toMatchObject({ runId: 'b3', attempt: 3, status: 'PASS' });
        expect(payload.members[0].previousAttempts).toEqual([
            { runId: 'b1', attempt: 1, status: 'FAIL' },
            { runId: 'b2', attempt: 2, status: 'FAIL' },
        ]);
    });

    it('reports no previous attempts for a group that never retried', async () => {
        seedSession([
            memberRun({ id: 'a1', testCaseId: 'a', attempt: 1, sessionPosition: 0, status: 'PASS' }),
        ], 'NONE');

        const payload = await (await GET(makeGetRequest(), { params })).json();

        expect(payload.members[0]).toMatchObject({ attempt: 1, previousAttempts: [] });
        expect(payload.retryPolicy).toBe('NONE');
    });

    it('returns 404 when the session is not in the project', async () => {
        mocks.runSessionFindFirst.mockResolvedValue(null);

        expect((await GET(makeGetRequest(), { params })).status).toBe(404);
    });
});
