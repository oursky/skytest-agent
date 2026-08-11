import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCELLATION_REASON } from '@/lib/runtime/cancellation-reasons';

/**
 * `update_test_case` with `cancel_and_save` is a stop, so it has to stop the same things every other
 * stop path does. Cancelling only this case's run would leave its group session driving: the group
 * would carry on, and with a retry policy would re-run this very case against the edit being saved.
 */
const mocks = vi.hoisted(() => ({
    getUserId: vi.fn(),
    isTestCaseProjectMember: vi.fn(),
    testCaseFindUnique: vi.fn(),
    testRunFindMany: vi.fn(),
    transaction: vi.fn(),
    cancelRunsForStop: vi.fn(),
}));

vi.mock('@/lib/mcp/server-auth', () => ({
    getUserId: mocks.getUserId,
    verifyProjectAccess: vi.fn(async () => true),
}));
vi.mock('@/lib/mcp/server-response', () => ({
    textResult: (payload: unknown) => ({ payload }),
    errorResult: (error: string, details?: unknown) => ({ error, details }),
    withToolTelemetry: (_name: string, run: () => unknown) => run(),
}));
vi.mock('@/lib/security/permissions', () => ({
    isTestCaseProjectMember: mocks.isTestCaseProjectMember,
}));
vi.mock('@/lib/mcp/run-cancellation', () => ({ cancelRunsForStop: mocks.cancelRunsForStop }));
vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testCase: { findUnique: mocks.testCaseFindUnique },
        testRun: { findMany: mocks.testRunFindMany },
        $transaction: mocks.transaction,
    },
}));

const { registerTestCaseMutationTools } = await import('@/lib/mcp/test-case-mutation-tools');

type Handler = (input: Record<string, unknown>, extra: unknown) => Promise<{ payload?: Record<string, unknown> }>;

/** Captures the registered handlers, since they are closures rather than exports. */
function captureHandlers(): Record<string, Handler> {
    const handlers: Record<string, Handler> = {};
    registerTestCaseMutationTools({
        registerTool: (name: string, _config: unknown, handler: Handler) => {
            handlers[name] = handler;
        },
    } as never);
    return handlers;
}

let updateTestCase: Handler;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockReturnValue('user-1');
    mocks.isTestCaseProjectMember.mockResolvedValue(true);
    mocks.testCaseFindUnique.mockResolvedValue({ id: 'case-1', projectId: 'project-1', kind: 'TEST' });
    mocks.transaction.mockResolvedValue({
        updated: { id: 'case-1', name: 'Renamed', status: 'DRAFT' },
        configChanges: [],
    });
    mocks.cancelRunsForStop.mockResolvedValue({
        cancelledRunIds: [],
        skipped: [],
        failures: [],
        sessionMembersAlsoCancelled: 0,
    });
    updateTestCase = captureHandlers().update_test_case;
});

describe('update_test_case with cancel_and_save', () => {
    it('stops the whole session a grouped case is running in', async () => {
        const activeRuns = [{ id: 'r1', status: 'RUNNING', createdAt: new Date(), runSessionId: 'session-1' }];
        mocks.testRunFindMany.mockResolvedValue(activeRuns);
        mocks.cancelRunsForStop.mockResolvedValue({
            cancelledRunIds: ['r1'],
            skipped: [],
            failures: [],
            sessionMembersAlsoCancelled: 2,
        });

        const result = await updateTestCase(
            { testCaseId: 'case-1', name: 'Renamed', activeRunResolution: 'cancel_and_save' },
            {},
        );

        expect(mocks.cancelRunsForStop).toHaveBeenCalledWith(activeRuns, CANCELLATION_REASON.MCP_FOR_UPDATE);
        expect(result.payload).toMatchObject({
            cancelledRuns: ['r1'],
            sessionMembersAlsoCancelled: 2,
        });
    });

    it('selects the session id so a grouped run can be routed to its session', async () => {
        mocks.testRunFindMany.mockResolvedValue([]);

        await updateTestCase(
            { testCaseId: 'case-1', name: 'Renamed', activeRunResolution: 'cancel_and_save' },
            {},
        );

        expect(mocks.testRunFindMany).toHaveBeenCalledWith(expect.objectContaining({
            select: expect.objectContaining({ runSessionId: true }),
        }));
    });

    it('reports a member that would not cancel as a failure', async () => {
        mocks.testRunFindMany.mockResolvedValue([
            { id: 'r1', status: 'RUNNING', createdAt: new Date(), runSessionId: 'session-1' },
        ]);
        mocks.cancelRunsForStop.mockResolvedValue({
            cancelledRunIds: [],
            skipped: [{ runId: 'r1', reason: 'Run settled PASS instead of cancelling' }],
            failures: [],
            sessionMembersAlsoCancelled: 0,
        });

        const result = await updateTestCase(
            { testCaseId: 'case-1', name: 'Renamed', activeRunResolution: 'cancel_and_save' },
            {},
        );

        expect(result.payload).toMatchObject({
            failedCancellations: [{ runId: 'r1', error: 'Run settled PASS instead of cancelling' }],
        });
    });

    it('cancels nothing when the caller chose to keep the active runs', async () => {
        mocks.testRunFindMany.mockResolvedValue([
            { id: 'r1', status: 'RUNNING', createdAt: new Date(), runSessionId: 'session-1' },
        ]);

        const result = await updateTestCase(
            { testCaseId: 'case-1', name: 'Renamed', activeRunResolution: 'do_not_save' },
            {},
        );

        expect(mocks.cancelRunsForStop).not.toHaveBeenCalled();
        expect(result.payload).toMatchObject({ saved: false });
    });
});
