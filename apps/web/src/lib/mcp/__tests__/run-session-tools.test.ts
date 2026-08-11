import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCELLATION_REASON } from '@/lib/runtime/cancellation-reasons';

/**
 * The tools an agent uses to watch and stop a retrying group. Their shapes matter to a caller that
 * cannot see the database: `get_run_session` must present one entry per case rather than one per
 * attempt, `get_test_run` must say which attempt a run is, and `stop_all_runs` must stop a session
 * as a unit rather than settling its rows.
 */
const mocks = vi.hoisted(() => ({
    getUserId: vi.fn(),
    verifyProjectAccess: vi.fn(),
    runSessionFindUnique: vi.fn(),
    testRunFindMany: vi.fn(),
    cancelRunsForStop: vi.fn(),
    gateSessionStop: vi.fn(),
    cancelRunDurably: vi.fn(),
    testRunFindUnique: vi.fn(),
    isTestRunProjectMember: vi.fn(),
}));

vi.mock('@/lib/security/permissions', () => ({
    isTestRunProjectMember: mocks.isTestRunProjectMember,
}));

vi.mock('@/lib/mcp/server-auth', () => ({
    getUserId: mocks.getUserId,
    verifyProjectAccess: mocks.verifyProjectAccess,
}));
vi.mock('@/lib/mcp/server-response', () => ({
    textResult: (payload: unknown) => ({ payload }),
    errorResult: (error: string, details?: unknown) => ({ error, details }),
    withToolTelemetry: (_name: string, run: () => unknown) => run(),
}));
vi.mock('@/lib/mcp/run-cancellation', () => ({
    cancelRunsForStop: mocks.cancelRunsForStop,
    gateSessionStop: mocks.gateSessionStop,
    cancelRunDurably: mocks.cancelRunDurably,
}));
vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        runSession: { findUnique: mocks.runSessionFindUnique },
        testRun: { findMany: mocks.testRunFindMany, findUnique: mocks.testRunFindUnique },
        user: { findUnique: vi.fn(async () => ({ email: 'agent@example.com' })) },
    },
}));

const { getRunSessionTool } = await import('@/lib/mcp/run-session-tools');
const { stopAllRunsTool, stopAllQueuesTool, getTestRunTool } = await import('@/lib/mcp/server-tools');

const extra = {} as never;

function attemptRow(options: {
    id: string;
    testCaseId: string;
    attempt: number;
    position: number;
    status: string;
    error?: string | null;
}) {
    return {
        id: options.id,
        testCaseId: options.testCaseId,
        kind: 'TEST',
        sessionPosition: options.position,
        attempt: options.attempt,
        status: options.status,
        error: options.error ?? null,
    };
}

type Payload = { payload: Record<string, unknown> };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockReturnValue('user-1');
    mocks.verifyProjectAccess.mockResolvedValue(true);
    mocks.isTestRunProjectMember.mockResolvedValue(true);
    // Default: nothing needed confirming, so the tool proceeds with everything it found.
    mocks.gateSessionStop.mockImplementation(async (runs: unknown[]) => ({
        targets: runs,
        sessionsLeftRunning: [],
    }));
});

describe('get_run_session', () => {
    function seed(memberRuns: ReturnType<typeof attemptRow>[], status = 'RUNNING') {
        mocks.runSessionFindUnique.mockResolvedValue({
            id: 'session-1',
            projectId: 'project-1',
            kind: 'GROUP',
            status,
            testGroupId: 'group-1',
            startedAt: null,
            completedAt: null,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            retryPolicy: 'FAILED_ONCE',
            retryPending: true,
            memberRuns,
        });
    }

    it('reports one entry per case, at its latest attempt', async () => {
        seed([
            attemptRow({ id: 'a1', testCaseId: 'a', attempt: 1, position: 0, status: 'PASS' }),
            attemptRow({ id: 'b1', testCaseId: 'b', attempt: 1, position: 1, status: 'FAIL' }),
            attemptRow({ id: 'b2', testCaseId: 'b', attempt: 2, position: 1, status: 'PASS' }),
        ]);

        const { payload } = await getRunSessionTool({ runSessionId: 'session-1' }, extra) as unknown as Payload;
        const members = payload.members as Array<{ id: string; attempt: number; status: string }>;

        expect(members.map((member) => [member.id, member.attempt, member.status]))
            .toEqual([['a1', 1, 'PASS'], ['b2', 2, 'PASS']]);
    });

    it('keeps superseded attempts under the case, with their reason codes', async () => {
        seed([
            attemptRow({ id: 'b1', testCaseId: 'b', attempt: 1, position: 0, status: 'FAIL' }),
            attemptRow({
                id: 'b2',
                testCaseId: 'b',
                attempt: 2,
                position: 0,
                status: 'CANCELLED',
                error: CANCELLATION_REASON.MCP,
            }),
        ]);

        const { payload } = await getRunSessionTool({ runSessionId: 'session-1' }, extra) as unknown as Payload;
        const members = payload.members as Array<{
            id: string;
            cancellationReasonCode: string | null;
            previousAttempts: Array<{ id: string; attempt: number; status: string }>;
        }>;

        expect(members).toHaveLength(1);
        expect(members[0].id).toBe('b2');
        expect(members[0].cancellationReasonCode).toBe('MCP');
        expect(members[0].previousAttempts).toEqual([
            { id: 'b1', attempt: 1, status: 'FAIL', error: null, cancellationReasonCode: null },
        ]);
    });

    it('still exposes retryPending so a caller can see a retry is pending', async () => {
        seed([attemptRow({ id: 'a1', testCaseId: 'a', attempt: 1, position: 0, status: 'FAIL' })]);

        const { payload } = await getRunSessionTool({ runSessionId: 'session-1' }, extra) as unknown as Payload;

        expect(payload.retryPending).toBe(true);
        expect(payload.status).toBe('RUNNING');
    });
});

describe('stop_all_runs', () => {
    it('stops runs through the session-aware canceller, not row by row', async () => {
        const activeRuns = [
            { id: 'r1', status: 'RUNNING', runSessionId: 'session-1' },
            { id: 'r2', status: 'QUEUED', runSessionId: 'session-1' },
        ];
        mocks.testRunFindMany.mockResolvedValue(activeRuns);
        mocks.cancelRunsForStop.mockResolvedValue({
            cancelledRunIds: ['r1', 'r2'],
            skipped: [],
            failures: [],
        });

        const { payload } = await stopAllRunsTool({ projectId: 'project-1' }, extra) as unknown as Payload;

        expect(mocks.cancelRunsForStop).toHaveBeenCalledWith(activeRuns, CANCELLATION_REASON.MCP);
        expect(mocks.cancelRunDurably).not.toHaveBeenCalled();
        expect(payload).toMatchObject({ cancelledRuns: 2, failedCancellations: 0, skippedCancellations: 0 });
    });

    it('passes a caller-supplied reason through to the canceller', async () => {
        mocks.testRunFindMany.mockResolvedValue([{ id: 'r1', status: 'RUNNING', runSessionId: 'session-1' }]);
        mocks.cancelRunsForStop.mockResolvedValue({ cancelledRunIds: ['r1'], skipped: [], failures: [] });

        await stopAllRunsTool({ projectId: 'project-1', reason: 'stopping to re-record' }, extra);

        expect(mocks.cancelRunsForStop).toHaveBeenCalledWith(expect.anything(), 'stopping to re-record');
    });

    it('selects the session id, so members can be routed to their session', async () => {
        mocks.testRunFindMany.mockResolvedValue([]);

        await stopAllRunsTool({ projectId: 'project-1' }, extra);

        expect(mocks.testRunFindMany).toHaveBeenCalledWith(expect.objectContaining({
            select: expect.objectContaining({ runSessionId: true }),
        }));
    });
});

describe('stop_all_queues', () => {
    it('stops the session a queued member belongs to, not just the row', async () => {
        const queuedRuns = [{ id: 'r2', status: 'QUEUED', runSessionId: 'session-1' }];
        mocks.testRunFindMany.mockResolvedValue(queuedRuns);
        mocks.cancelRunsForStop.mockResolvedValue({
            cancelledRunIds: ['r2'],
            skipped: [],
            failures: [],
            sessionMembersAlsoCancelled: 1,
        });

        const { payload } = await stopAllQueuesTool({ projectId: 'project-1' }, extra) as unknown as Payload;

        expect(mocks.cancelRunsForStop).toHaveBeenCalledWith(queuedRuns, CANCELLATION_REASON.MCP);
        expect(mocks.cancelRunDurably).not.toHaveBeenCalled();
        // The running sibling that went with it is reported rather than hidden.
        expect(payload).toMatchObject({ cancelledRuns: 1, sessionMembersAlsoCancelled: 1 });
    });

    it('selects the session id so members can be routed', async () => {
        mocks.testRunFindMany.mockResolvedValue([]);

        await stopAllQueuesTool({ projectId: 'project-1' }, extra);

        expect(mocks.testRunFindMany).toHaveBeenCalledWith(expect.objectContaining({
            select: expect.objectContaining({ runSessionId: true }),
        }));
    });
});

describe('stop confirmation', () => {
    const sessions = [{
        sessionId: 'session-1',
        kind: 'GROUP',
        testGroupId: 'group-1',
        testGroupName: 'Checkout regression',
        requestedRunIds: ['r1'],
        activeMembers: 3,
    }];

    for (const tool of ['stop_all_runs', 'stop_all_queues'] as const) {
        it(`${tool} returns the confirmation and stops nothing until the caller answers`, async () => {
            mocks.testRunFindMany.mockResolvedValue([{ id: 'r1', status: 'QUEUED', runSessionId: 'session-1' }]);
            mocks.gateSessionStop.mockResolvedValue({
                confirmation: {
                    message: 'Some of these runs belong to run sessions.',
                    details: { code: 'SESSION_STOP_CONFIRMATION_REQUIRED', sessions, options: ['stop_sessions', 'only_standalone'] },
                },
                targets: [],
                sessionsLeftRunning: [],
            });

            const run = tool === 'stop_all_runs' ? stopAllRunsTool : stopAllQueuesTool;
            const result = await run({ projectId: 'project-1' }, extra) as unknown as {
                error: string;
                details: Record<string, unknown>;
            };

            expect(result.error).toContain('run sessions');
            expect(result.details).toMatchObject({ code: 'SESSION_STOP_CONFIRMATION_REQUIRED', sessions });
            expect(mocks.cancelRunsForStop).not.toHaveBeenCalled();
        });

        it(`${tool} forwards the caller's answer to the gate and stops only its targets`, async () => {
            mocks.testRunFindMany.mockResolvedValue([
                { id: 'r1', status: 'QUEUED', runSessionId: 'session-1' },
                { id: 'solo', status: 'QUEUED', runSessionId: null },
            ]);
            mocks.gateSessionStop.mockResolvedValue({
                targets: [{ id: 'solo', status: 'QUEUED', runSessionId: null }],
                sessionsLeftRunning: sessions,
            });
            mocks.cancelRunsForStop.mockResolvedValue({
                cancelledRunIds: ['solo'], skipped: [], failures: [], sessionMembersAlsoCancelled: 0,
            });

            const run = tool === 'stop_all_runs' ? stopAllRunsTool : stopAllQueuesTool;
            const { payload } = await run(
                { projectId: 'project-1', activeSessionResolution: 'only_standalone' },
                extra,
            ) as unknown as Payload;

            expect(mocks.gateSessionStop).toHaveBeenCalledWith(
                expect.anything(),
                'only_standalone',
                expect.objectContaining({ projectId: 'project-1' }),
            );
            expect(mocks.cancelRunsForStop).toHaveBeenCalledWith(
                [{ id: 'solo', status: 'QUEUED', runSessionId: null }],
                CANCELLATION_REASON.MCP,
            );
            expect(payload.sessionsLeftRunning).toEqual(sessions);
        });
    }
});

describe('get_test_run', () => {
    it('reports which attempt the run is, so a superseded one is recognisable', async () => {
        mocks.testRunFindUnique.mockResolvedValue({
            id: 'b1',
            status: 'FAIL',
            error: 'assertion failed',
            startedAt: null,
            completedAt: null,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            kind: 'TEST',
            runSessionId: 'session-1',
            sessionPosition: 1,
            attempt: 2,
            runSession: { id: 'session-1', status: 'RUNNING', kind: 'GROUP' },
        });

        const { payload } = await getTestRunTool({ runId: 'b1' }, extra) as unknown as Payload;

        expect(payload).toMatchObject({ id: 'b1', attempt: 2, runSessionId: 'session-1' });
        // The session status stays the authority on whether the group finished.
        expect(payload.session).toMatchObject({ status: 'RUNNING' });
    });
});
