import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    verifyAuth: vi.fn(),
    resolveUserId: vi.fn(),
    isProjectMember: vi.fn(),
    publishRunUpdate: vi.fn(),
    cancelLocalBrowserRun: vi.fn(),
    dispatchNextQueuedBrowserRun: vi.fn(),
    testRunFindUnique: vi.fn(),
    testRunUpdateMany: vi.fn(),
    testCaseUpdate: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
    verifyAuth: mocks.verifyAuth,
    resolveUserId: mocks.resolveUserId,
}));

vi.mock('@/lib/security/permissions', () => ({
    isProjectMember: mocks.isProjectMember,
}));

vi.mock('@/lib/runners/event-bus', () => ({
    publishRunUpdate: mocks.publishRunUpdate,
}));

vi.mock('@/lib/runtime/local-browser-runner', () => ({
    cancelLocalBrowserRun: mocks.cancelLocalBrowserRun,
}));

vi.mock('@/lib/runtime/browser-run-dispatcher', () => ({
    dispatchNextQueuedBrowserRun: mocks.dispatchNextQueuedBrowserRun,
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findUnique: mocks.testRunFindUnique,
        },
        $transaction: mocks.transaction,
    },
}));

const { POST } = await import('@/app/api/test-runs/[id]/cancel/route');

describe('POST /api/test-runs/[id]/cancel', () => {
    beforeEach(() => {
        mocks.verifyAuth.mockReset();
        mocks.resolveUserId.mockReset();
        mocks.isProjectMember.mockReset();
        mocks.publishRunUpdate.mockReset();
        mocks.cancelLocalBrowserRun.mockReset();
        mocks.dispatchNextQueuedBrowserRun.mockReset();
        mocks.testRunFindUnique.mockReset();
        mocks.testRunUpdateMany.mockReset();
        mocks.testCaseUpdate.mockReset();
        mocks.transaction.mockReset();

        mocks.verifyAuth.mockResolvedValue({ sub: 'auth-user' });
        mocks.resolveUserId.mockResolvedValue('user-1');
        mocks.isProjectMember.mockResolvedValue(true);
        mocks.testRunFindUnique.mockResolvedValue({
            id: 'run-1',
            status: 'RUNNING',
            testCaseId: 'tc-1',
            assignedRunnerId: 'runner-1',
            deletedAt: null,
            testCase: {
                projectId: 'project-1',
            },
        });
        mocks.transaction.mockImplementation(async (callback: (tx: {
            testRun: {
                updateMany: typeof mocks.testRunUpdateMany;
                findUnique: typeof mocks.testRunFindUnique;
            };
            testCase: { update: typeof mocks.testCaseUpdate };
        }) => Promise<unknown>) => callback({
            testRun: {
                updateMany: mocks.testRunUpdateMany,
                findUnique: mocks.testRunFindUnique,
            },
            testCase: { update: mocks.testCaseUpdate },
        }));
        mocks.testRunUpdateMany.mockResolvedValue({ count: 1 });
        mocks.testCaseUpdate.mockResolvedValue({ id: 'tc-1', status: 'CANCELLED' });
        mocks.dispatchNextQueuedBrowserRun.mockResolvedValue(true);
    });

    it('cancels active runs and updates test case status to CANCELLED', async () => {
        const request = new Request('http://localhost/api/test-runs/run-1/cancel', { method: 'POST' });

        const response = await POST(request, { params: Promise.resolve({ id: 'run-1' }) });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.transaction).toHaveBeenCalledTimes(1);
        expect(mocks.testRunUpdateMany).toHaveBeenCalledWith({
            where: {
                id: 'run-1',
                status: { in: ['RUNNING', 'QUEUED', 'PREPARING'] },
            },
            data: {
                status: 'CANCELLED',
                error: 'Cancelled by user',
                completedAt: expect.any(Date),
                assignedRunnerId: null,
                leaseExpiresAt: null,
            },
        });
        expect(mocks.testCaseUpdate).toHaveBeenCalledWith({
            where: { id: 'tc-1' },
            data: { status: 'CANCELLED' },
        });
        expect(mocks.publishRunUpdate).toHaveBeenCalledWith('run-1');
        expect(mocks.cancelLocalBrowserRun).toHaveBeenCalledWith('run-1');
        expect(mocks.dispatchNextQueuedBrowserRun).toHaveBeenCalledTimes(1);
        expect(payload).toMatchObject({
            success: true,
            id: 'run-1',
            status: 'CANCELLED',
        });
    });

    it('does not overwrite terminal run statuses', async () => {
        mocks.testRunFindUnique.mockResolvedValueOnce({
            id: 'run-1',
            status: 'PASS',
            testCaseId: 'tc-1',
            assignedRunnerId: null,
            deletedAt: null,
            testCase: {
                projectId: 'project-1',
            },
        });

        const request = new Request('http://localhost/api/test-runs/run-1/cancel', { method: 'POST' });

        const response = await POST(request, { params: Promise.resolve({ id: 'run-1' }) });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.transaction).not.toHaveBeenCalled();
        expect(mocks.publishRunUpdate).not.toHaveBeenCalled();
        expect(mocks.cancelLocalBrowserRun).toHaveBeenCalledWith('run-1');
        expect(mocks.dispatchNextQueuedBrowserRun).not.toHaveBeenCalled();
        expect(payload).toMatchObject({
            success: true,
            id: 'run-1',
            status: 'PASS',
        });
    });

    it('does not overwrite terminal status when run transitions before guarded update', async () => {
        mocks.testRunFindUnique.mockResolvedValueOnce({
            id: 'run-1',
            status: 'RUNNING',
            testCaseId: 'tc-1',
            assignedRunnerId: 'runner-1',
            deletedAt: null,
            testCase: {
                projectId: 'project-1',
            },
        });
        mocks.testRunUpdateMany.mockResolvedValueOnce({ count: 0 });
        mocks.testRunFindUnique.mockResolvedValueOnce({
            status: 'PASS',
        });

        const request = new Request('http://localhost/api/test-runs/run-1/cancel', { method: 'POST' });

        const response = await POST(request, { params: Promise.resolve({ id: 'run-1' }) });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.testRunUpdateMany).toHaveBeenCalledTimes(1);
        expect(mocks.testCaseUpdate).not.toHaveBeenCalled();
        expect(mocks.publishRunUpdate).not.toHaveBeenCalled();
        expect(mocks.cancelLocalBrowserRun).toHaveBeenCalledWith('run-1');
        expect(mocks.dispatchNextQueuedBrowserRun).not.toHaveBeenCalled();
        expect(payload).toMatchObject({
            success: true,
            id: 'run-1',
            status: 'PASS',
        });
    });
});
