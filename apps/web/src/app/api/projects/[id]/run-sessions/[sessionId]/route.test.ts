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

const { POST } = await import('@/app/api/projects/[id]/run-sessions/[sessionId]/route');

const params = Promise.resolve({ id: 'project-1', sessionId: 'session-1' });
const makeRequest = () => new Request('http://localhost/api/projects/project-1/run-sessions/session-1', { method: 'POST' });

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
