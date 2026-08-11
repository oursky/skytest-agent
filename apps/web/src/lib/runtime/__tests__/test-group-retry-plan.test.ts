import { describe, expect, it } from 'vitest';
import {
    buildCaseRetryStates,
    countSessionCases,
    maxRetryRoundsFor,
    planRetryRound,
    resolveLatestAttempts,
    retriesPerCaseFor,
    retryPolicyRunsRetries,
    type AttemptRecord,
    type CaseRetryState,
} from '@/lib/runtime/test-group-retry-plan';
import {
    TEST_CASE_KIND,
    TEST_GROUP_FAILURE_MODE,
    TEST_GROUP_RETRY_POLICY,
    TEST_STATUS,
} from '@/types';

const { STOP, CONTINUE } = TEST_GROUP_FAILURE_MODE;
const { NONE, FAILED_ONCE, FAILED_TWICE, WHOLE_GROUP_ONCE } = TEST_GROUP_RETRY_POLICY;

function attempt(
    testCaseId: string,
    sessionPosition: number,
    attemptNumber: number,
    status: string,
    kind: string = TEST_CASE_KIND.TEST,
): AttemptRecord {
    return { testCaseId, sessionPosition, attempt: attemptNumber, status, kind };
}

function state(
    testCaseId: string,
    sessionPosition: number,
    latestStatus: string,
    executed: number,
    kind: string = TEST_CASE_KIND.TEST,
): CaseRetryState {
    return { testCaseId, sessionPosition, latestStatus, executed, kind };
}

describe('retriesPerCaseFor', () => {
    it('maps each policy to its per-case budget', () => {
        expect(retriesPerCaseFor(NONE)).toBe(0);
        expect(retriesPerCaseFor(FAILED_ONCE)).toBe(1);
        expect(retriesPerCaseFor(FAILED_TWICE)).toBe(2);
    });

    it('reports which policies retry at all', () => {
        expect(retryPolicyRunsRetries(NONE)).toBe(false);
        expect(retryPolicyRunsRetries(FAILED_ONCE)).toBe(true);
        expect(retryPolicyRunsRetries(WHOLE_GROUP_ONCE)).toBe(true);
    });
});

describe('resolveLatestAttempts', () => {
    it('keeps the highest attempt per case, ordered by session position', () => {
        const latest = resolveLatestAttempts([
            attempt('b', 1, 1, TEST_STATUS.FAIL),
            attempt('a', 0, 1, TEST_STATUS.PASS),
            attempt('b', 1, 2, TEST_STATUS.PASS),
        ]);
        expect(latest.map((row) => [row.testCaseId, row.attempt, row.status])).toEqual([
            ['a', 1, TEST_STATUS.PASS],
            ['b', 2, TEST_STATUS.PASS],
        ]);
    });
});

describe('countSessionCases', () => {
    it('counts each case once however many attempts it has', () => {
        expect(countSessionCases([
            attempt('a', 0, 1, TEST_STATUS.PASS),
            attempt('b', 1, 1, TEST_STATUS.FAIL),
            attempt('b', 1, 2, TEST_STATUS.FAIL),
            attempt('b', 1, 3, TEST_STATUS.PASS),
        ])).toBe(2);
    });

    it('is zero for a session with no members', () => {
        expect(countSessionCases([])).toBe(0);
    });
});

describe('buildCaseRetryStates', () => {
    it('counts only executed attempts and takes the latest status', () => {
        const states = buildCaseRetryStates([
            attempt('a', 0, 1, TEST_STATUS.FAIL),
            attempt('a', 0, 2, TEST_STATUS.PASS),
            attempt('b', 1, 1, TEST_STATUS.CANCELLED),
        ]);
        expect(states).toEqual([
            state('a', 0, TEST_STATUS.PASS, 2),
            state('b', 1, TEST_STATUS.CANCELLED, 0),
        ]);
    });

    it('is independent of input order', () => {
        const forward = buildCaseRetryStates([
            attempt('a', 0, 1, TEST_STATUS.FAIL),
            attempt('a', 0, 2, TEST_STATUS.PASS),
        ]);
        const reversed = buildCaseRetryStates([
            attempt('a', 0, 2, TEST_STATUS.PASS),
            attempt('a', 0, 1, TEST_STATUS.FAIL),
        ]);
        expect(forward).toEqual(reversed);
    });
});

describe('planRetryRound — failed-case policies', () => {
    it('picks FAIL and CANCELLED cases and skips passes', () => {
        const plan = planRetryRound([
            state('a', 0, TEST_STATUS.PASS, 1),
            state('b', 1, TEST_STATUS.FAIL, 1),
            state('c', 2, TEST_STATUS.CANCELLED, 0),
        ], FAILED_ONCE, STOP, 0);
        expect(plan.map((row) => row.testCaseId)).toEqual(['b', 'c']);
    });

    it('returns an empty plan when everything passed', () => {
        const plan = planRetryRound([
            state('a', 0, TEST_STATUS.PASS, 1),
            state('b', 1, TEST_STATUS.PASS, 2),
        ], FAILED_TWICE, STOP, 0);
        expect(plan).toEqual([]);
    });

    it('returns an empty plan for the NONE policy', () => {
        const plan = planRetryRound([state('a', 0, TEST_STATUS.FAIL, 1)], NONE, STOP, 0);
        expect(plan).toEqual([]);
    });

    it('orders the plan by original session position', () => {
        const plan = planRetryRound([
            state('c', 2, TEST_STATUS.CANCELLED, 0),
            state('a', 0, TEST_STATUS.FAIL, 1),
        ], FAILED_ONCE, CONTINUE, 0);
        expect(plan.map((row) => row.testCaseId)).toEqual(['a', 'c']);
    });

    it('includes login flows like any other case', () => {
        const plan = planRetryRound([
            state('login', 0, TEST_STATUS.FAIL, 1, TEST_CASE_KIND.LOGIN_FLOW),
            state('a', 1, TEST_STATUS.CANCELLED, 0),
        ], FAILED_ONCE, STOP, 0);
        expect(plan.map((row) => row.testCaseId)).toEqual(['login', 'a']);
    });
});

describe('planRetryRound — per-case budget', () => {
    it('keeps a case eligible while it has budget left', () => {
        const plan = planRetryRound([state('a', 0, TEST_STATUS.FAIL, 1)], FAILED_ONCE, CONTINUE, 0);
        expect(plan.map((row) => row.testCaseId)).toEqual(['a']);
    });

    it('drops a case once it has executed its full allowance', () => {
        const plan = planRetryRound([state('a', 0, TEST_STATUS.FAIL, 2)], FAILED_ONCE, CONTINUE, 0);
        expect(plan).toEqual([]);
    });

    it('gives a never-executed cancelled case its full allowance', () => {
        // The case only ever got cancelled, so executed = 0: it is eligible even in a late round.
        const plan = planRetryRound([state('a', 0, TEST_STATUS.CANCELLED, 0)], FAILED_ONCE, CONTINUE, 5);
        expect(plan.map((row) => row.testCaseId)).toEqual(['a']);
    });

    it('gives a case first executed in a retry round a retry of its own', () => {
        // Case b was cancelled in round 0 and failed on its first real execution in round 1.
        const plan = planRetryRound([
            state('a', 0, TEST_STATUS.PASS, 2),
            state('b', 1, TEST_STATUS.FAIL, 1),
            state('c', 2, TEST_STATUS.CANCELLED, 0),
        ], FAILED_ONCE, STOP, 1);
        expect(plan.map((row) => row.testCaseId)).toEqual(['b', 'c']);
    });
});

describe('planRetryRound — STOP blocking and termination', () => {
    it('stops retrying when an unresolved case has exhausted its budget under STOP', () => {
        // Case b is permanently broken; c/d can never run, so without this rule the loop
        // would replan [c, d] forever at executed = 0.
        const plan = planRetryRound([
            state('a', 0, TEST_STATUS.PASS, 1),
            state('b', 1, TEST_STATUS.FAIL, 2),
            state('c', 2, TEST_STATUS.CANCELLED, 0),
            state('d', 3, TEST_STATUS.CANCELLED, 0),
        ], FAILED_ONCE, STOP, 1);
        expect(plan).toEqual([]);
    });

    it('still retries other cases under CONTINUE when one is exhausted', () => {
        const plan = planRetryRound([
            state('b', 1, TEST_STATUS.FAIL, 2),
            state('c', 2, TEST_STATUS.FAIL, 1),
        ], FAILED_ONCE, CONTINUE, 1);
        expect(plan.map((row) => row.testCaseId)).toEqual(['c']);
    });

    it('does not block under STOP while the exhausted case has passed', () => {
        const plan = planRetryRound([
            state('a', 0, TEST_STATUS.PASS, 2),
            state('b', 1, TEST_STATUS.FAIL, 1),
        ], FAILED_ONCE, STOP, 1);
        expect(plan.map((row) => row.testCaseId)).toEqual(['b']);
    });
});

describe('planRetryRound — WHOLE_GROUP_ONCE', () => {
    it('re-runs every case regardless of status once any case is unresolved', () => {
        const plan = planRetryRound([
            state('login', 0, TEST_STATUS.PASS, 1, TEST_CASE_KIND.LOGIN_FLOW),
            state('a', 1, TEST_STATUS.PASS, 1),
            state('b', 2, TEST_STATUS.FAIL, 1),
        ], WHOLE_GROUP_ONCE, STOP, 0);
        expect(plan.map((row) => row.testCaseId)).toEqual(['login', 'a', 'b']);
    });

    it('retries nothing when every case passed', () => {
        expect(planRetryRound([
            state('login', 0, TEST_STATUS.PASS, 1, TEST_CASE_KIND.LOGIN_FLOW),
            state('a', 1, TEST_STATUS.PASS, 1),
            state('b', 2, TEST_STATUS.PASS, 1),
        ], WHOLE_GROUP_ONCE, STOP, 0)).toEqual([]);
    });

    it('is triggered by a case left cancelled behind a failure', () => {
        const plan = planRetryRound([
            state('a', 0, TEST_STATUS.PASS, 1),
            state('b', 1, TEST_STATUS.CANCELLED, 0),
        ], WHOLE_GROUP_ONCE, STOP, 0);
        expect(plan.map((row) => row.testCaseId)).toEqual(['a', 'b']);
    });

    it('never runs more than one extra pass', () => {
        const cases = [state('a', 0, TEST_STATUS.FAIL, 2)];
        expect(planRetryRound(cases, WHOLE_GROUP_ONCE, STOP, 1)).toEqual([]);
        expect(planRetryRound(cases, WHOLE_GROUP_ONCE, CONTINUE, 2)).toEqual([]);
    });
});

describe('maxRetryRoundsFor', () => {
    it('bounds failed-case policies by budget times case count', () => {
        expect(maxRetryRoundsFor(FAILED_ONCE, 10)).toBe(10);
        expect(maxRetryRoundsFor(FAILED_TWICE, 10)).toBe(20);
        expect(maxRetryRoundsFor(NONE, 10)).toBe(0);
    });

    it('bounds a whole-group retry to a single round', () => {
        expect(maxRetryRoundsFor(WHOLE_GROUP_ONCE, 10)).toBe(1);
    });
});
