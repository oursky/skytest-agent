import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_CASE_KIND, TEST_GROUP_RETRY_POLICY, TEST_STATUS } from '@/types';

/**
 * Retry rounds are driven by what the session's rows say happened, so a generic mock would let a
 * broken loop pass. This harness keeps a real in-memory TestRun table: claims flip rows to
 * PREPARING, runTest writes the outcome (standing in for finalizeMemberRunResult), cancels apply
 * to still-queued rows, and createRetryAttempts inserts genuine new attempt rows. The loop
 * therefore observes the same state transitions it would in production.
 */
interface Row {
    id: string;
    runSessionId: string;
    testCaseId: string;
    kind: string;
    sessionPosition: number;
    attempt: number;
    status: string;
    requiredCapability: string | null;
    triggeredByEmail: string | null;
    triggerSource: string;
}

const SESSION_ID = 'session-1';

const mocks = vi.hoisted(() => ({
    runSessionFindUnique: vi.fn(),
    runSessionUpdateMany: vi.fn(),
    testRunFindMany: vi.fn(),
    testRunUpdateMany: vi.fn(),
    testRunFindUnique: vi.fn(),
    testRunCreate: vi.fn(),
    testCaseUpdate: vi.fn(),
    loadRunConfig: vi.fn(),
    runTest: vi.fn(),
    executeUnit: vi.fn(),
    setupExecutionTargets: vi.fn(),
    cleanupTargets: vi.fn(),
    finalizeMemberRunResult: vi.fn(),
    finalizeMemberRunError: vi.fn(),
    recomputeRunSessionForMember: vi.fn(),
    recomputeRunSessionStatus: vi.fn(),
    releaseSessionRetryHold: vi.fn(),
    failActiveSessionMembers: vi.fn(),
    publishRunUpdate: vi.fn(),
    emitRunTerminal: vi.fn(),
    updateRunStatusWithOwnership: vi.fn(),
    failRunWithoutTestCase: vi.fn(),
    createRunEventSink: vi.fn(),
    createRunStatusWatcher: vi.fn(),
    touchRunActivity: vi.fn(),
    logWarn: vi.fn(),
}));

vi.mock('@/lib/core/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: mocks.logWarn, error: vi.fn() }),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        runSession: { findUnique: mocks.runSessionFindUnique, updateMany: mocks.runSessionUpdateMany },
        testRun: {
            findMany: mocks.testRunFindMany,
            updateMany: mocks.testRunUpdateMany,
            findUnique: mocks.testRunFindUnique,
            create: mocks.testRunCreate,
        },
        testCase: { update: mocks.testCaseUpdate },
    },
}));

vi.mock('@/lib/runtime/run-config-loader', () => ({ loadRunConfig: mocks.loadRunConfig }));
vi.mock('@/lib/runtime/test-runner', () => ({
    runTest: mocks.runTest,
    setupExecutionTargets: mocks.setupExecutionTargets,
    cleanupTargets: mocks.cleanupTargets,
    executeUnit: mocks.executeUnit,
}));
vi.mock('@/lib/runtime/run-member-finalize', () => ({
    finalizeMemberRunResult: mocks.finalizeMemberRunResult,
    finalizeMemberRunError: mocks.finalizeMemberRunError,
}));
vi.mock('@/lib/runtime/run-session-service', () => ({
    recomputeRunSessionForMember: mocks.recomputeRunSessionForMember,
    recomputeRunSessionStatus: mocks.recomputeRunSessionStatus,
    releaseSessionRetryHold: mocks.releaseSessionRetryHold,
    failActiveSessionMembers: mocks.failActiveSessionMembers,
}));
vi.mock('@/lib/runners/event-bus', () => ({ publishRunUpdate: mocks.publishRunUpdate }));
vi.mock('@/lib/runners/domain-events', () => ({ emitRunTerminal: mocks.emitRunTerminal }));
vi.mock('@/lib/runtime/local-browser-runner-lifecycle', () => ({
    updateRunStatusWithOwnership: mocks.updateRunStatusWithOwnership,
    createLeaseExpiry: vi.fn(() => new Date()),
    withLoginFlowBrowserSlot: (fn: () => unknown) => fn(),
    withSessionMemberBrowserSlot: (fn: () => unknown) => fn(),
    failRunWithoutTestCase: mocks.failRunWithoutTestCase,
}));
vi.mock('@/lib/runtime/execution-files', () => ({
    prepareExecutionFiles: async () => ({ configFiles: {}, cleanup: async () => {} }),
}));
vi.mock('@/lib/runtime/midscene-env', () => ({ buildMidsceneModelConfig: () => ({}) }));
vi.mock('@/lib/runtime/run-event-sink', () => ({
    createRunEventSink: mocks.createRunEventSink,
    createRunStatusWatcher: mocks.createRunStatusWatcher,
    touchRunActivity: mocks.touchRunActivity,
}));

import { executeGroupSession } from '@/lib/runtime/run-session-orchestrator';

/** Per-case outcome queue: each execution of that case consumes the next entry. */
type OutcomeScript = Record<string, string[]>;

interface GroupSetup {
    cases: string[];
    outcomes: OutcomeScript;
    retryPolicy: string;
    failureMode?: 'STOP' | 'CONTINUE';
    executionMode?: 'SEQUENTIAL' | 'PARALLEL';
    loginFlows?: string[];
}

let rows: Row[];
/** Every member execution in order, whichever engine ran it (login flows use executeUnit). */
let executed: string[];

function seedRows(setup: GroupSetup): void {
    rows = [];
    executed = [];
    const members = [
        ...(setup.loginFlows ?? []).map((id) => ({ id, kind: TEST_CASE_KIND.LOGIN_FLOW })),
        ...setup.cases.map((id) => ({ id, kind: TEST_CASE_KIND.TEST })),
    ];
    // A decoy attempt of the same case in a different session, with a far higher attempt number.
    // Every query is session-scoped, so nothing may ever see it; a query that drops the scope
    // numbers its next attempt from 9 and fails loudly instead of coincidentally being right.
    const [firstMember] = members;
    if (firstMember) {
        rows.push({
            id: 'decoy-other-session',
            runSessionId: 'other-session',
            testCaseId: firstMember.id,
            kind: firstMember.kind,
            sessionPosition: 0,
            attempt: 9,
            status: TEST_STATUS.FAIL,
            requiredCapability: 'ANDROID',
            triggeredByEmail: null,
            triggerSource: 'SCHEDULE',
        });
    }
    members.forEach((member, index) => {
        rows.push({
            id: `${member.id}#1`,
            runSessionId: SESSION_ID,
            testCaseId: member.id,
            kind: member.kind,
            sessionPosition: index,
            attempt: 1,
            status: TEST_STATUS.QUEUED,
            requiredCapability: 'BROWSER',
            triggeredByEmail: null,
            triggerSource: 'USER',
        });
    });
}

function matchesWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
    if (!where) {
        return true;
    }
    if (typeof where.id === 'string' && row.id !== where.id) {
        return false;
    }
    const statusFilter = where.status as { in?: string[] } | string | undefined;
    if (typeof statusFilter === 'string' && row.status !== statusFilter) {
        return false;
    }
    if (statusFilter && typeof statusFilter === 'object' && Array.isArray(statusFilter.in)
        && !statusFilter.in.includes(row.status)) {
        return false;
    }
    const caseFilter = where.testCaseId as { in?: string[] } | undefined;
    if (caseFilter?.in && !caseFilter.in.includes(row.testCaseId)) {
        return false;
    }
    // Honoured rather than assumed: a query that forgets to scope by session then reads the
    // other session's rows seeded below, instead of quietly getting the right answer anyway.
    if (typeof where.runSessionId === 'string' && row.runSessionId !== where.runSessionId) {
        return false;
    }
    return true;
}

/**
 * Applies the caller's own orderBy instead of hardcoding the order each query happens to want, so
 * flipping a production sort direction shows up here as a wrong result rather than being masked.
 */
function orderRows(
    matched: Row[],
    orderBy: { attempt?: 'asc' | 'desc' } | { sessionPosition?: 'asc' | 'desc' }[] | undefined,
): Row[] {
    const clauses = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean) as Record<string, 'asc' | 'desc'>[];
    if (clauses.length === 0) {
        return matched;
    }
    return [...matched].sort((left, right) => {
        for (const clause of clauses) {
            for (const [field, direction] of Object.entries(clause)) {
                const delta = Number(left[field as keyof Row]) - Number(right[field as keyof Row]);
                if (delta !== 0) {
                    return direction === 'desc' ? -delta : delta;
                }
            }
        }
        return 0;
    });
}

function installPrismaFake(setup: GroupSetup): void {
    const remaining: OutcomeScript = Object.fromEntries(
        Object.entries(setup.outcomes).map(([key, value]) => [key, [...value]]),
    );

    mocks.runSessionFindUnique.mockResolvedValue({
        retryPolicy: setup.retryPolicy,
        project: { maxConcurrentRuns: 5 },
        testGroup: {
            onFailure: setup.failureMode ?? 'STOP',
            executionMode: setup.executionMode ?? 'SEQUENTIAL',
        },
    });
    mocks.runSessionUpdateMany.mockResolvedValue({ count: 1 });

    mocks.testRunFindMany.mockImplementation(async (args: {
        where?: Record<string, unknown>;
        orderBy?: { attempt?: 'asc' | 'desc' } | { sessionPosition?: 'asc' | 'desc' }[];
        select?: Record<string, boolean>;
    }) => {
        const matched = orderRows(rows.filter((row) => matchesWhere(row, args.where)), args.orderBy);
        const select = args.select ?? {};
        if (select.requiredCapability) {
            return matched.map((row) => ({
                testCaseId: row.testCaseId,
                attempt: row.attempt,
                requiredCapability: row.requiredCapability,
                triggeredByEmail: row.triggeredByEmail,
                triggerSource: row.triggerSource,
            }));
        }
        if (select.attempt) {
            return matched.map((row) => ({
                testCaseId: row.testCaseId,
                kind: row.kind,
                sessionPosition: row.sessionPosition,
                attempt: row.attempt,
                status: row.status,
            }));
        }
        return matched.map((row) => ({
            id: row.id,
            sessionPosition: row.sessionPosition,
            testCaseId: row.testCaseId,
            kind: row.kind,
            reusedSession: false,
        }));
    });

    mocks.testRunUpdateMany.mockImplementation(async (args: {
        where: Record<string, unknown>;
        data: { status?: string };
    }) => {
        const matched = rows.filter((row) => matchesWhere(row, args.where));
        for (const row of matched) {
            if (args.data.status) {
                row.status = args.data.status;
            }
        }
        return { count: matched.length };
    });

    mocks.testRunFindUnique.mockImplementation(async (args: { where: { id: string } }) => {
        const row = rows.find((candidate) => candidate.id === args.where.id);
        return row ? { status: row.status, runSessionId: SESSION_ID } : null;
    });

    mocks.testRunCreate.mockImplementation(async (args: {
        data: {
            runSessionId: string; testCaseId: string; sessionPosition: number;
            attempt: number; kind: string; status: string;
        };
    }) => {
        const row: Row = {
            id: `${args.data.testCaseId}#${args.data.attempt}`,
            runSessionId: args.data.runSessionId,
            testCaseId: args.data.testCaseId,
            kind: args.data.kind,
            sessionPosition: args.data.sessionPosition,
            attempt: args.data.attempt,
            status: args.data.status,
            requiredCapability: 'BROWSER',
            triggeredByEmail: null,
            triggerSource: 'USER',
        };
        rows.push(row);
        return { id: row.id, sessionPosition: row.sessionPosition, testCaseId: row.testCaseId, kind: row.kind, reusedSession: false };
    });

    mocks.testCaseUpdate.mockResolvedValue({});
    mocks.loadRunConfig.mockImplementation(async (runId: string) => ({
        runId,
        projectId: 'p1',
        testCaseId: rows.find((row) => row.id === runId)?.testCaseId ?? runId,
        usage: { actorUserId: 'u1', description: 'desc' },
        config: { url: 'https://example.com', browserConfig: {} },
    }));

    // Stands in for finalizeMemberRunResult writing the member's terminal status. A case with no
    // scripted outcome just passes, but running *past* a script that was written for it means the
    // loop did more rounds than the test describes — silently passing that would hide over-running,
    // so it is an error rather than a default.
    const settle = (runId: string): string => {
        const row = rows.find((candidate) => candidate.id === runId);
        const caseId = row?.testCaseId ?? '';
        const script = remaining[caseId];
        if (script && script.length === 0) {
            throw new Error(`${caseId} executed more times than its outcome script describes (${runId})`);
        }
        const status = script?.shift() ?? TEST_STATUS.PASS;
        if (row) {
            row.status = status;
        }
        executed.push(runId);
        return status;
    };

    mocks.runTest.mockImplementation(async (input: { runId: string }) => ({ status: settle(input.runId) }));
    // Login-flow members run through the shared-target engine instead of runTest.
    mocks.executeUnit.mockImplementation(async (input: { runId: string }) => ({ status: settle(input.runId) }));
    mocks.setupExecutionTargets.mockImplementation(async () => ({
        contexts: new Map([['session_main', { storageState: async () => ({ cookies: [], origins: [] }) }]]),
    }));
    mocks.cleanupTargets.mockResolvedValue(undefined);
    mocks.failRunWithoutTestCase.mockResolvedValue(undefined);
    mocks.updateRunStatusWithOwnership.mockResolvedValue(undefined);
    mocks.touchRunActivity.mockResolvedValue(undefined);
    mocks.finalizeMemberRunResult.mockResolvedValue(undefined);

    mocks.createRunEventSink.mockReturnValue({
        handleTestEvent: vi.fn(),
        queueEvent: vi.fn(),
        flush: vi.fn().mockResolvedValue(undefined),
        settleUploads: vi.fn().mockResolvedValue(undefined),
    });
    mocks.createRunStatusWatcher.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
    mocks.releaseSessionRetryHold.mockResolvedValue(true);
    mocks.recomputeRunSessionStatus.mockResolvedValue(undefined);
}

async function runGroup(setup: GroupSetup, controller = new AbortController()): Promise<void> {
    seedRows(setup);
    installPrismaFake(setup);
    await executeGroupSession(SESSION_ID, controller);
}

/** Run ids executed, in order — `case#attempt`. */
function executions(): string[] {
    return executed;
}

/** Final status per case, keyed by test case id. */
function finalStatuses(): Record<string, string> {
    const final: Record<string, { attempt: number; status: string }> = {};
    for (const row of rows.filter((candidate) => candidate.runSessionId === SESSION_ID)) {
        if (!final[row.testCaseId] || row.attempt > final[row.testCaseId].attempt) {
            final[row.testCaseId] = { attempt: row.attempt, status: row.status };
        }
    }
    return Object.fromEntries(Object.entries(final).map(([key, value]) => [key, value.status]));
}

/** Safety-ceiling warnings emitted; a healthy run must produce none. */
function ceilingWarnings(): string[] {
    return mocks.logWarn.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes('safety ceiling'));
}

const { FAILED_ONCE, FAILED_TWICE, WHOLE_GROUP_ONCE, NONE } = TEST_GROUP_RETRY_POLICY;

describe('executeGroupSession retries — sequential STOP', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it('retries the failed case and then continues the cases it had cancelled', async () => {
        await runGroup({
            cases: ['a', 'b', 'c', 'd'],
            outcomes: { b: [TEST_STATUS.FAIL, TEST_STATUS.PASS] },
            retryPolicy: FAILED_ONCE,
        });

        // Round 0 stops at b; round 1 retries b, and on its pass c and d finally run.
        expect(executions()).toEqual(['a#1', 'b#1', 'b#2', 'c#2', 'd#2']);
        expect(finalStatuses()).toEqual({ a: 'PASS', b: 'PASS', c: 'PASS', d: 'PASS' });
    });

    it('gives a case first executed during a retry round its own retry', async () => {
        await runGroup({
            cases: ['a', 'b', 'c'],
            outcomes: { b: [TEST_STATUS.FAIL, TEST_STATUS.PASS], c: [TEST_STATUS.FAIL, TEST_STATUS.PASS] },
            retryPolicy: FAILED_ONCE,
        });

        // c was cancelled in round 0, so its first real execution is in round 1 and it still
        // has a retry left for round 2 — the per-case budget in action.
        expect(executions()).toEqual(['a#1', 'b#1', 'b#2', 'c#2', 'c#3']);
        expect(finalStatuses()).toEqual({ a: 'PASS', b: 'PASS', c: 'PASS' });
    });

    it('stops once a permanently failing case exhausts its budget, leaving the tail cancelled', async () => {
        await runGroup({
            cases: ['a', 'b', 'c'],
            outcomes: { b: [TEST_STATUS.FAIL, TEST_STATUS.FAIL] },
            retryPolicy: FAILED_ONCE,
        });

        // Without the STOP-blocked rule, c would sit at executed = 0 and be replanned forever.
        expect(executions()).toEqual(['a#1', 'b#1', 'b#2']);
        expect(finalStatuses()).toEqual({ a: 'PASS', b: 'FAIL', c: 'CANCELLED' });
    });

    it('uses the second retry when a case only passes on its third attempt', async () => {
        await runGroup({
            cases: ['a', 'b'],
            outcomes: { b: [TEST_STATUS.FAIL, TEST_STATUS.FAIL, TEST_STATUS.PASS] },
            retryPolicy: FAILED_TWICE,
        });

        expect(executions()).toEqual(['a#1', 'b#1', 'b#2', 'b#3']);
        expect(finalStatuses()).toEqual({ a: 'PASS', b: 'PASS' });
    });

    it('retries a failed login flow and runs the cases it had blocked', async () => {
        await runGroup({
            loginFlows: ['login'],
            cases: ['a'],
            outcomes: { login: [TEST_STATUS.FAIL, TEST_STATUS.PASS] },
            retryPolicy: FAILED_ONCE,
        });

        expect(executions()).toContain('login#2');
        expect(finalStatuses()).toEqual({ login: 'PASS', a: 'PASS' });
    });
});

describe('executeGroupSession retries — sequential CONTINUE', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it('retries only the failed cases and leaves passed ones untouched', async () => {
        await runGroup({
            cases: ['a', 'b', 'c', 'd'],
            outcomes: { b: [TEST_STATUS.FAIL, TEST_STATUS.PASS], d: [TEST_STATUS.FAIL, TEST_STATUS.PASS] },
            retryPolicy: FAILED_ONCE,
            failureMode: 'CONTINUE',
        });

        expect(executions()).toEqual(['a#1', 'b#1', 'c#1', 'd#1', 'b#2', 'd#2']);
        expect(finalStatuses()).toEqual({ a: 'PASS', b: 'PASS', c: 'PASS', d: 'PASS' });
    });

    it('keeps retrying cases that still have budget when a sibling is exhausted', async () => {
        await runGroup({
            cases: ['a', 'b'],
            outcomes: {
                a: [TEST_STATUS.FAIL, TEST_STATUS.FAIL, TEST_STATUS.FAIL],
                b: [TEST_STATUS.FAIL, TEST_STATUS.FAIL, TEST_STATUS.PASS],
            },
            retryPolicy: FAILED_TWICE,
            failureMode: 'CONTINUE',
        });

        // a spends all three of its executions and stays failed; b keeps its own budget and
        // recovers on its last one. Neither case's budget is charged to the other.
        expect(executions()).toEqual(['a#1', 'b#1', 'a#2', 'b#2', 'a#3', 'b#3']);
        expect(finalStatuses()).toEqual({ a: 'FAIL', b: 'PASS' });
    });
});

describe('executeGroupSession retries — whole group', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it('re-runs every case once regardless of status, login flows included', async () => {
        await runGroup({
            loginFlows: ['login'],
            cases: ['a', 'b'],
            outcomes: { b: [TEST_STATUS.FAIL, TEST_STATUS.PASS] },
            retryPolicy: WHOLE_GROUP_ONCE,
            failureMode: 'CONTINUE',
        });

        expect(executions()).toEqual(['login#1', 'a#1', 'b#1', 'login#2', 'a#2', 'b#2']);
    });

    it('does not retry a group that came back fully green', async () => {
        await runGroup({
            cases: ['a', 'b'],
            outcomes: {},
            retryPolicy: WHOLE_GROUP_ONCE,
        });

        expect(executions()).toEqual(['a#1', 'b#1']);
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
    });

    it('re-runs passing cases too once any case has failed', async () => {
        await runGroup({
            cases: ['a', 'b', 'c'],
            outcomes: { b: [TEST_STATUS.FAIL, TEST_STATUS.PASS] },
            retryPolicy: WHOLE_GROUP_ONCE,
            failureMode: 'CONTINUE',
        });

        expect(executions()).toEqual(['a#1', 'b#1', 'c#1', 'a#2', 'b#2', 'c#2']);
        expect(finalStatuses()).toEqual({ a: 'PASS', b: 'PASS', c: 'PASS' });
    });

    it('never runs more than one extra pass even when cases still fail', async () => {
        await runGroup({
            cases: ['a'],
            outcomes: { a: [TEST_STATUS.FAIL, TEST_STATUS.FAIL, TEST_STATUS.FAIL] },
            retryPolicy: WHOLE_GROUP_ONCE,
            failureMode: 'CONTINUE',
        });

        expect(executions()).toEqual(['a#1', 'a#2']);
        expect(finalStatuses()).toEqual({ a: 'FAIL' });
    });
});

describe('executeGroupSession retries — guards', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it('does not warn about the safety ceiling on runs that use their whole budget', async () => {
        // Both configurations exhaust the ceiling exactly: WHOLE_GROUP_ONCE allows one round, and
        // FAILED_ONCE on a single case allows retries * caseCount = 1. Reaching the bound legally
        // is not the bug the warning is meant to report.
        await runGroup({
            cases: ['a'],
            outcomes: { a: [TEST_STATUS.FAIL, TEST_STATUS.FAIL] },
            retryPolicy: WHOLE_GROUP_ONCE,
        });
        expect(executions()).toEqual(['a#1', 'a#2']);
        expect(ceilingWarnings()).toEqual([]);

        await runGroup({
            cases: ['a'],
            outcomes: { a: [TEST_STATUS.FAIL, TEST_STATUS.FAIL] },
            retryPolicy: FAILED_ONCE,
        });
        expect(executions()).toEqual(['a#1', 'a#2']);
        expect(ceilingWarnings()).toEqual([]);
    });

    it('NONE retries nothing, matching pre-retry behaviour', async () => {
        await runGroup({
            cases: ['a', 'b', 'c'],
            outcomes: { b: [TEST_STATUS.FAIL] },
            retryPolicy: NONE,
        });

        expect(executions()).toEqual(['a#1', 'b#1']);
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
        expect(finalStatuses()).toEqual({ a: 'PASS', b: 'FAIL', c: 'CANCELLED' });
    });

    it('plans no retry round when the whole group passed', async () => {
        await runGroup({ cases: ['a', 'b'], outcomes: {}, retryPolicy: FAILED_TWICE });

        expect(executions()).toEqual(['a#1', 'b#1']);
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
    });

    it('does not start a retry round once the session is aborted', async () => {
        const controller = new AbortController();
        seedRows({ cases: ['a'], outcomes: {}, retryPolicy: FAILED_ONCE });
        installPrismaFake({ cases: ['a'], outcomes: { a: [TEST_STATUS.FAIL] }, retryPolicy: FAILED_ONCE });
        mocks.runTest.mockImplementation(async (input: { runId: string }) => {
            const row = rows.find((candidate) => candidate.id === input.runId);
            if (row) {
                row.status = TEST_STATUS.FAIL;
            }
            executed.push(input.runId);
            controller.abort();
            return { status: TEST_STATUS.FAIL };
        });

        await executeGroupSession(SESSION_ID, controller);

        expect(executions()).toEqual(['a#1']);
        expect(mocks.testRunCreate).not.toHaveBeenCalled();
    });

    it('always releases the retry hold and recomputes the session', async () => {
        await runGroup({
            cases: ['a'],
            outcomes: { a: [TEST_STATUS.FAIL, TEST_STATUS.FAIL] },
            retryPolicy: FAILED_ONCE,
        });

        expect(mocks.releaseSessionRetryHold).toHaveBeenCalledWith('session-1');
        expect(mocks.recomputeRunSessionStatus).toHaveBeenCalledWith('session-1');
    });
});
