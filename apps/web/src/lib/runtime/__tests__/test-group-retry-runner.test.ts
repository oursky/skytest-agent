import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_CASE_KIND, TEST_GROUP_RETRY_POLICY, TEST_STATUS } from '@/types';
import { CANCELLATION_REASON } from '@/lib/runtime/cancellation-reasons';

/**
 * `runGroupRetryRounds` takes `runRound` by injection, so the loop is driven directly here rather
 * than through the orchestrator. That reaches the no-progress backstop a realistic group cannot
 * produce, and pins how a new attempt row is derived from the previous ones — which attempt it
 * counts from, which fields it carries, and that it never looks outside its own session.
 *
 * The prisma fake honours `where.runSessionId` and `orderBy` rather than assuming them, so a query
 * that drops either one fails here instead of being silently compensated for.
 */
interface Row {
    id: string;
    runSessionId: string;
    testCaseId: string;
    kind: string;
    attempt: number;
    sessionPosition: number;
    status: string;
    error: string | null;
    requiredCapability: string | null;
    triggeredByEmail: string | null;
    triggerSource: string;
}

let rows: Row[];
let created: Row[];

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findMany: vi.fn(async ({ where, orderBy, select }: {
                where: { runSessionId: string; testCaseId?: { in: string[] } };
                orderBy?: { attempt?: 'asc' | 'desc' };
                select?: Record<string, boolean>;
            }) => {
                let matched = rows.filter((row) => row.runSessionId === where.runSessionId
                    && (!where.testCaseId || where.testCaseId.in.includes(row.testCaseId)));
                if (orderBy?.attempt) {
                    matched = [...matched].sort((a, b) => (orderBy.attempt === 'desc'
                        ? b.attempt - a.attempt
                        : a.attempt - b.attempt));
                }
                const fields = Object.keys(select ?? {});
                return matched.map((row) => (fields.length === 0
                    ? { ...row }
                    : Object.fromEntries(fields.map((key) => [key, row[key as keyof Row]]))));
            }),
            create: vi.fn(async ({ data }: { data: Omit<Row, 'id'> }) => {
                const row: Row = { ...data, id: `${data.testCaseId}#${data.attempt}` };
                rows.push(row);
                // Snapshot, so `created` still describes the row as inserted after a round mutates it.
                created.push({ ...row });
                return {
                    id: row.id,
                    sessionPosition: row.sessionPosition,
                    testCaseId: row.testCaseId,
                    kind: row.kind,
                    reusedSession: false,
                };
            }),
        },
    },
}));

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock('@/lib/core/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: logWarn, error: vi.fn() }),
}));

import { runGroupRetryRounds, type SessionMember } from '@/lib/runtime/test-group-retry-runner';

/** `cases` maps a case id to the status of each attempt it already has, oldest first. */
function seed(cases: Record<string, string[]>, sessionId = 'session-1'): void {
    rows = [];
    created = [];
    Object.entries(cases).forEach(([testCaseId, statuses], position) => {
        statuses.forEach((status, index) => {
            rows.push({
                id: `${testCaseId}#${index + 1}`,
                runSessionId: sessionId,
                testCaseId,
                kind: TEST_CASE_KIND.TEST,
                attempt: index + 1,
                sessionPosition: position,
                status,
                error: null,
                requiredCapability: 'BROWSER',
                triggeredByEmail: 'user@example.com',
                triggerSource: 'USER',
            });
        });
    });
}

/** A round that settles every member it was handed. */
function settleRoundWith(status: string) {
    return async (members: SessionMember[]) => {
        for (const member of members) {
            rows.find((row) => row.id === member.id)!.status = status;
        }
    };
}

function runRounds(options: {
    policy: string;
    failureMode?: 'STOP' | 'CONTINUE';
    signal?: AbortSignal;
    runRound: (members: SessionMember[]) => Promise<void>;
}): Promise<void> {
    return runGroupRetryRounds({
        sessionId: 'session-1',
        retryPolicy: options.policy as never,
        failureMode: (options.failureMode ?? 'CONTINUE') as never,
        signal: options.signal ?? new AbortController().signal,
        runRound: options.runRound,
    });
}

function warnings(fragment: string): number {
    return logWarn.mock.calls.filter((call) => String(call[0]).includes(fragment)).length;
}

beforeEach(() => vi.clearAllMocks());

describe('runGroupRetryRounds — new attempt rows', () => {
    it('numbers a new attempt from the highest existing one, not the oldest', async () => {
        seed({ a: [TEST_STATUS.FAIL, TEST_STATUS.FAIL] });

        await runRounds({
            policy: TEST_GROUP_RETRY_POLICY.FAILED_TWICE,
            runRound: settleRoundWith(TEST_STATUS.PASS),
        });

        expect(created.map((row) => row.attempt)).toEqual([3]);
        expect(rows.filter((row) => row.testCaseId === 'a').map((row) => row.attempt)).toEqual([1, 2, 3]);
    });

    it('carries the previous attempt row dispatch fields onto the retry', async () => {
        seed({ a: [TEST_STATUS.FAIL] });

        await runRounds({
            policy: TEST_GROUP_RETRY_POLICY.FAILED_ONCE,
            runRound: settleRoundWith(TEST_STATUS.PASS),
        });

        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({
            runSessionId: 'session-1',
            requiredCapability: 'BROWSER',
            triggeredByEmail: 'user@example.com',
            triggerSource: 'USER',
            status: TEST_STATUS.QUEUED,
            sessionPosition: 0,
        });
    });

    it('only ever considers attempts from its own session', async () => {
        seed({ a: [TEST_STATUS.FAIL] });
        rows.push({
            id: 'a#9', runSessionId: 'other-session', testCaseId: 'a', kind: TEST_CASE_KIND.TEST,
            attempt: 9, sessionPosition: 0, status: TEST_STATUS.FAIL, error: null,
            requiredCapability: 'ANDROID',
            triggeredByEmail: 'someone-else@example.com', triggerSource: 'SCHEDULE',
        });

        await runRounds({
            policy: TEST_GROUP_RETRY_POLICY.FAILED_ONCE,
            runRound: settleRoundWith(TEST_STATUS.PASS),
        });

        // Attempt 2, not 10 — and none of the other session's dispatch fields leak in.
        expect(created).toHaveLength(1);
        expect(created[0].attempt).toBe(2);
        expect(created[0].requiredCapability).toBe('BROWSER');
        expect(created[0].triggerSource).toBe('USER');
    });
});

describe('runGroupRetryRounds — loop exits', () => {
    it('stops and warns when a round executed nothing', async () => {
        seed({ a: [TEST_STATUS.FAIL] });

        // A round that leaves its member queued makes no progress. Without the guard the plan
        // would keep selecting the same case — its budget never spent — forever.
        await runRounds({
            policy: TEST_GROUP_RETRY_POLICY.FAILED_TWICE,
            runRound: async () => {},
        });

        expect(created).toHaveLength(1);
        expect(warnings('executed nothing')).toBe(1);
    });

    it('stops on its own once every case has spent its budget, without warning', async () => {
        seed({ a: [TEST_STATUS.FAIL] });

        await runRounds({
            policy: TEST_GROUP_RETRY_POLICY.FAILED_TWICE,
            runRound: settleRoundWith(TEST_STATUS.FAIL),
        });

        // Two retries allowed, so attempts 2 and 3, then the budget filter empties the plan.
        expect(created.map((row) => row.attempt)).toEqual([2, 3]);
        expect(warnings('safety ceiling')).toBe(0);
        expect(warnings('executed nothing')).toBe(0);
    });

    it('does not create attempts for a policy that retries nothing', async () => {
        seed({ a: [TEST_STATUS.FAIL] });

        await runRounds({
            policy: TEST_GROUP_RETRY_POLICY.NONE,
            failureMode: 'STOP',
            runRound: async () => {
                throw new Error('must not run a round for NONE');
            },
        });

        expect(created).toEqual([]);
    });

    it('does not start a round once the signal is aborted', async () => {
        seed({ a: [TEST_STATUS.FAIL] });
        const controller = new AbortController();
        controller.abort();

        await runRounds({
            policy: TEST_GROUP_RETRY_POLICY.FAILED_ONCE,
            signal: controller.signal,
            runRound: async () => {
                throw new Error('must not run a round after abort');
            },
        });

        expect(created).toEqual([]);
    });

    it('does not retry a case that somebody stopped', async () => {
        seed({ a: [TEST_STATUS.CANCELLED] });
        rows[0].error = CANCELLATION_REASON.MCP;

        await runRounds({
            policy: TEST_GROUP_RETRY_POLICY.FAILED_TWICE,
            runRound: async () => {
                throw new Error('must not retry a run that was deliberately stopped');
            },
        });

        expect(created).toEqual([]);
    });

    it('still retries a case the group skipped behind a failure', async () => {
        seed({ a: [TEST_STATUS.CANCELLED] });
        rows[0].error = CANCELLATION_REASON.EARLIER_CASE_FAILED;

        await runRounds({
            policy: TEST_GROUP_RETRY_POLICY.FAILED_ONCE,
            runRound: settleRoundWith(TEST_STATUS.PASS),
        });

        expect(created.map((row) => row.attempt)).toEqual([2]);
    });

    it('retries nothing when the group came back fully green', async () => {
        seed({ a: [TEST_STATUS.PASS], b: [TEST_STATUS.PASS] });

        await runRounds({
            policy: TEST_GROUP_RETRY_POLICY.WHOLE_GROUP_ONCE,
            runRound: async () => {
                throw new Error('must not retry a passing group');
            },
        });

        expect(created).toEqual([]);
    });
});
