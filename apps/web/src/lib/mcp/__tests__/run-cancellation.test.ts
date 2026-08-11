import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_ACTIVE_STATUSES } from '@/types';

const {
    testRunFindUnique, testRunUpdateMany, testCaseUpdate, androidResourceLockDeleteMany, transaction,
    testRunFindMany, runSessionFindMany, cancelActiveRunSession,
} = vi.hoisted(() => ({
    testRunFindMany: vi.fn(),
    runSessionFindMany: vi.fn(),
    cancelActiveRunSession: vi.fn(),
    testRunFindUnique: vi.fn(),
    testRunUpdateMany: vi.fn(),
    testCaseUpdate: vi.fn(),
    androidResourceLockDeleteMany: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findUnique: testRunFindUnique,
            findMany: testRunFindMany,
        },
        runSession: { findMany: runSessionFindMany },
        $transaction: transaction,
    },
}));

vi.mock('@/lib/runtime/cancel-run', () => ({ cancelActiveRunSession }));

const { cancelRunDurably, cancelRunsForStop, gateSessionStop } = await import('@/lib/mcp/run-cancellation');

describe('cancelRunDurably', () => {
    beforeEach(() => {
        testRunFindUnique.mockReset();
        testRunUpdateMany.mockReset();
        testCaseUpdate.mockReset();
        androidResourceLockDeleteMany.mockReset();
        transaction.mockReset();
        transaction.mockImplementation(async (callback: (tx: {
            testRun: { updateMany: typeof testRunUpdateMany };
            testCase: { update: typeof testCaseUpdate };
            androidResourceLock: { deleteMany: typeof androidResourceLockDeleteMany };
        }) => Promise<unknown>) => callback({
            testRun: { updateMany: testRunUpdateMany },
            testCase: { update: testCaseUpdate },
            androidResourceLock: { deleteMany: androidResourceLockDeleteMany },
        }));
    });

    it('returns false when the run does not exist', async () => {
        testRunFindUnique.mockResolvedValueOnce(null);

        await expect(cancelRunDurably('run-1', 'reason')).resolves.toBe(false);
        expect(testRunUpdateMany).not.toHaveBeenCalled();
        expect(testCaseUpdate).not.toHaveBeenCalled();
    });

    it('returns false when the run is already terminal', async () => {
        testRunFindUnique.mockResolvedValueOnce({
            id: 'run-1',
            status: 'PASS',
            testCaseId: 'tc-1',
        });

        await expect(cancelRunDurably('run-1', 'reason')).resolves.toBe(false);
        expect(testRunUpdateMany).not.toHaveBeenCalled();
        expect(testCaseUpdate).not.toHaveBeenCalled();
    });

    it('returns false when the run becomes non-active before update', async () => {
        testRunFindUnique.mockResolvedValueOnce({
            id: 'run-1',
            status: 'RUNNING',
            testCaseId: 'tc-1',
        });
        testRunUpdateMany.mockResolvedValueOnce({ count: 0 });

        await expect(cancelRunDurably('run-1', 'reason')).resolves.toBe(false);
        expect(testCaseUpdate).not.toHaveBeenCalled();
    });

    it('cancels active runs and updates test case status', async () => {
        testRunFindUnique.mockResolvedValueOnce({
            id: 'run-1',
            status: 'RUNNING',
            testCaseId: 'tc-1',
        });
        testRunUpdateMany.mockResolvedValueOnce({ count: 1 });
        testCaseUpdate.mockResolvedValueOnce({ id: 'tc-1', status: 'CANCELLED' });

        await expect(cancelRunDurably('run-1', 'Cancelled by test')).resolves.toBe(true);

        expect(testRunUpdateMany).toHaveBeenCalledWith({
            where: {
                id: 'run-1',
                status: { in: [...RUN_ACTIVE_STATUSES] },
            },
            data: {
                status: 'CANCELLED',
                error: 'Cancelled by test',
                completedAt: expect.any(Date),
                assignedRunnerId: null,
                leaseExpiresAt: null,
            },
        });
        expect(testCaseUpdate).toHaveBeenCalledWith({
            where: { id: 'tc-1' },
            data: { status: 'CANCELLED' },
        });
        expect(androidResourceLockDeleteMany).toHaveBeenCalledWith({
            where: {
                runId: 'run-1',
            },
        });
    });
});


/**
 * A stop tool must not settle a session member row on its own. The session's driver would keep
 * going — the status watcher only aborts that member's controller — and a group with a retry policy
 * would create replacement attempts straight after the stop.
 */
describe('cancelRunsForStop', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cancelActiveRunSession.mockResolvedValue({ cancelledMembers: 1 });
        transaction.mockImplementation(async (callback: (tx: {
            testRun: { updateMany: typeof testRunUpdateMany };
            testCase: { update: typeof testCaseUpdate };
            androidResourceLock: { deleteMany: typeof androidResourceLockDeleteMany };
        }) => Promise<unknown>) => callback({
            testRun: { updateMany: testRunUpdateMany },
            testCase: { update: testCaseUpdate },
            androidResourceLock: { deleteMany: androidResourceLockDeleteMany },
        }));
    });

    it('stops a session member through the session, once per session, with the caller reason', async () => {
        testRunFindMany.mockResolvedValue([
            { id: 'r1', status: 'CANCELLED' },
            { id: 'r2', status: 'CANCELLED' },
        ]);

        const outcome = await cancelRunsForStop([
            { id: 'r1', runSessionId: 'session-1' },
            { id: 'r2', runSessionId: 'session-1' },
        ], 'stopped from MCP');

        expect(cancelActiveRunSession).toHaveBeenCalledTimes(1);
        expect(cancelActiveRunSession).toHaveBeenCalledWith('session-1', 'stopped from MCP');
        expect(testRunFindUnique).not.toHaveBeenCalled();
        expect(outcome.cancelledRunIds).toEqual(['r1', 'r2']);
        expect(outcome.failures).toEqual([]);
    });

    it('cancels each distinct session exactly once', async () => {
        testRunFindMany.mockResolvedValue([
            { id: 'r1', status: 'CANCELLED' },
            { id: 'r2', status: 'CANCELLED' },
        ]);

        await cancelRunsForStop([
            { id: 'r1', runSessionId: 'session-1' },
            { id: 'r2', runSessionId: 'session-2' },
        ], 'reason');

        expect(cancelActiveRunSession.mock.calls.map((call) => call[0])).toEqual(['session-1', 'session-2']);
    });

    it('reports a member that settled on its own instead of cancelling', async () => {
        testRunFindMany.mockResolvedValue([{ id: 'r1', status: 'PASS' }]);

        const outcome = await cancelRunsForStop([{ id: 'r1', runSessionId: 'session-1' }], 'reason');

        expect(outcome.cancelledRunIds).toEqual([]);
        expect(outcome.skipped).toEqual([
            { runId: 'r1', reason: 'Run settled PASS instead of cancelling' },
        ]);
    });

    it('reports a failing session cancel against every run it covered', async () => {
        cancelActiveRunSession.mockRejectedValue(new Error('boom'));

        const outcome = await cancelRunsForStop([
            { id: 'r1', runSessionId: 'session-1' },
            { id: 'r2', runSessionId: 'session-1' },
        ], 'reason');

        expect(outcome.failures).toEqual([
            { runId: 'r1', error: 'boom' },
            { runId: 'r2', error: 'boom' },
        ]);
        expect(outcome.cancelledRunIds).toEqual([]);
    });

    it('still cancels a standalone run directly', async () => {
        testRunFindUnique.mockResolvedValue({ id: 'solo', status: RUN_ACTIVE_STATUSES[0], testCaseId: 'case-1' });
        testRunUpdateMany.mockResolvedValue({ count: 1 });

        const outcome = await cancelRunsForStop([{ id: 'solo', runSessionId: null }], 'reason');

        expect(cancelActiveRunSession).not.toHaveBeenCalled();
        expect(outcome.cancelledRunIds).toEqual(['solo']);
    });
});


/**
 * Stopping is session-wide, so a request naming one queued case can end a whole test group. The gate
 * makes the caller confirm that first, rather than discovering it from the result.
 */
describe('gateSessionStop', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runSessionFindMany.mockResolvedValue([{
            id: 'session-1',
            kind: 'GROUP',
            testGroupId: 'group-1',
            testGroup: { name: 'Checkout regression' },
            memberRuns: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
        }]);
    });

    it('asks for confirmation, naming the test group, and stops nothing yet', async () => {
        const gate = await gateSessionStop(
            [{ id: 'r1', runSessionId: 'session-1' }],
            undefined,
            { projectId: 'project-1' },
        );

        expect(gate.targets).toEqual([]);
        expect(gate.confirmation?.message).toContain('Checkout regression');
        expect(gate.confirmation?.details).toMatchObject({
            projectId: 'project-1',
            code: 'SESSION_STOP_CONFIRMATION_REQUIRED',
            options: ['stop_sessions', 'only_standalone'],
        });
        // The caller can see it named one run but three members would settle.
        expect(gate.confirmation?.details.sessions).toEqual([expect.objectContaining({
            sessionId: 'session-1',
            testGroupName: 'Checkout regression',
            requestedRunIds: ['r1'],
            activeMembers: 3,
        })]);
    });

    it('needs no confirmation when nothing belongs to a session', async () => {
        const gate = await gateSessionStop(
            [{ id: 'solo', runSessionId: null }],
            undefined,
            {},
        );

        expect(gate.confirmation).toBeUndefined();
        expect(gate.targets).toEqual([{ id: 'solo', runSessionId: null }]);
        expect(runSessionFindMany).not.toHaveBeenCalled();
    });

    it('stops everything once the caller confirms stop_sessions', async () => {
        const runs = [{ id: 'r1', runSessionId: 'session-1' }, { id: 'solo', runSessionId: null }];

        const gate = await gateSessionStop(runs, 'stop_sessions', {});

        expect(gate.confirmation).toBeUndefined();
        expect(gate.targets).toEqual(runs);
        expect(gate.sessionsLeftRunning).toEqual([]);
    });

    it('leaves the sessions alone for only_standalone, and says which it left', async () => {
        const gate = await gateSessionStop(
            [{ id: 'r1', runSessionId: 'session-1' }, { id: 'solo', runSessionId: null }],
            'only_standalone',
            {},
        );

        expect(gate.targets).toEqual([{ id: 'solo', runSessionId: null }]);
        expect(gate.sessionsLeftRunning).toEqual([expect.objectContaining({ sessionId: 'session-1' })]);
    });

    it('describes a non-group session without inventing a group name', async () => {
        runSessionFindMany.mockResolvedValue([{
            id: 'session-2',
            kind: 'SINGLE',
            testGroupId: null,
            testGroup: null,
            memberRuns: [{ id: 'r9' }],
        }]);

        const gate = await gateSessionStop([{ id: 'r9', runSessionId: 'session-2' }], undefined, {});

        expect(gate.confirmation?.details.sessions).toEqual([expect.objectContaining({
            kind: 'SINGLE',
            testGroupName: null,
        })]);
        expect(gate.confirmation?.message).not.toContain('Test groups affected');
    });
});
