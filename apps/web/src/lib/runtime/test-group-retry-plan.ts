import {
    TEST_GROUP_FAILURE_MODE,
    TEST_GROUP_RETRY_POLICY,
    TEST_STATUS,
    type TestGroupFailureMode,
    type TestGroupRetryPolicy,
} from '@/types';

/** Retries allowed per case. WHOLE_GROUP_ONCE is not per-case — it is one extra pass, see planRetryRound. */
export function retriesPerCaseFor(policy: TestGroupRetryPolicy): number {
    switch (policy) {
        case TEST_GROUP_RETRY_POLICY.FAILED_ONCE:
            return 1;
        case TEST_GROUP_RETRY_POLICY.FAILED_TWICE:
            return 2;
        default:
            return 0;
    }
}

export function retryPolicyRunsRetries(policy: TestGroupRetryPolicy): boolean {
    return policy !== TEST_GROUP_RETRY_POLICY.NONE;
}

export interface AttemptRecord {
    testCaseId: string;
    kind: string;
    sessionPosition: number | null;
    attempt: number;
    status: string;
}

export interface CaseRetryState {
    testCaseId: string;
    kind: string;
    sessionPosition: number;
    latestStatus: string;
    /** Attempts that actually ran. A CANCELLED attempt never executed and does not spend budget. */
    executed: number;
}

/** Latest attempt per case, ordered by the case's original position in the session. */
export function resolveLatestAttempts<T extends { testCaseId: string; attempt: number; sessionPosition: number | null }>(
    attempts: readonly T[],
): T[] {
    const latest = new Map<string, T>();
    for (const attempt of attempts) {
        const current = latest.get(attempt.testCaseId);
        if (!current || attempt.attempt > current.attempt) {
            latest.set(attempt.testCaseId, attempt);
        }
    }
    return [...latest.values()].sort((a, b) => (a.sessionPosition ?? 0) - (b.sessionPosition ?? 0));
}

/** Folds every attempt of a session into one retry state per case. Input order does not matter. */
export function buildCaseRetryStates(attempts: readonly AttemptRecord[]): CaseRetryState[] {
    const states = new Map<string, CaseRetryState>();
    const latestAttemptByCase = new Map<string, number>();
    for (const attempt of attempts) {
        const executed = attempt.status === TEST_STATUS.PASS || attempt.status === TEST_STATUS.FAIL ? 1 : 0;
        const existing = states.get(attempt.testCaseId);
        if (!existing) {
            states.set(attempt.testCaseId, {
                testCaseId: attempt.testCaseId,
                kind: attempt.kind,
                sessionPosition: attempt.sessionPosition ?? 0,
                latestStatus: attempt.status,
                executed,
            });
            latestAttemptByCase.set(attempt.testCaseId, attempt.attempt);
            continue;
        }
        existing.executed += executed;
        if (attempt.attempt >= (latestAttemptByCase.get(attempt.testCaseId) ?? 0)) {
            latestAttemptByCase.set(attempt.testCaseId, attempt.attempt);
            existing.latestStatus = attempt.status;
        }
    }
    return [...states.values()].sort((a, b) => a.sessionPosition - b.sessionPosition);
}

function isUnresolved(state: CaseRetryState): boolean {
    return state.latestStatus === TEST_STATUS.FAIL || state.latestStatus === TEST_STATUS.CANCELLED;
}

/**
 * The cases a retry round should re-run, or [] to stop retrying.
 *
 * WHOLE_GROUP_ONCE re-runs every case exactly once more, then stops. The failed-case policies
 * re-run each unresolved case that still has budget, where budget counts only attempts that
 * actually executed — a case cancelled by stop-on-failure has spent nothing, so its first real
 * execution during a retry round still leaves it a full allowance.
 *
 * Under STOP, an unresolved case that has spent its whole budget blocks the group: everything
 * behind it stays cancelled (which is what stop-on-failure means) and retrying stops. Without
 * this the loop would never terminate, because those cancelled cases sit at executed = 0 forever
 * and keep looking eligible.
 */
export function planRetryRound(
    cases: readonly CaseRetryState[],
    policy: TestGroupRetryPolicy,
    failureMode: TestGroupFailureMode,
    roundIndex: number,
): CaseRetryState[] {
    if (policy === TEST_GROUP_RETRY_POLICY.WHOLE_GROUP_ONCE) {
        return roundIndex === 0 ? [...cases].sort((a, b) => a.sessionPosition - b.sessionPosition) : [];
    }

    const retries = retriesPerCaseFor(policy);
    if (retries === 0) {
        return [];
    }

    const unresolved = cases.filter(isUnresolved);
    if (unresolved.length === 0) {
        return [];
    }

    const maxExecutions = retries + 1;
    if (failureMode !== TEST_GROUP_FAILURE_MODE.CONTINUE
        && unresolved.some((state) => state.executed >= maxExecutions)) {
        return [];
    }

    return unresolved
        .filter((state) => state.executed < maxExecutions)
        .sort((a, b) => a.sessionPosition - b.sessionPosition);
}

/**
 * Hard ceiling on retry rounds. Each case executes at most `retries + 1` times and round 0 spends
 * one execution per case, so `retries * caseCount` executions remain; every retry round consumes at
 * least one (the orchestrator's no-progress guard enforces that). Reaching this bound therefore
 * means a bug, not a slow run — it exists so the session settles instead of wedging.
 */
export function maxRetryRoundsFor(policy: TestGroupRetryPolicy, caseCount: number): number {
    if (policy === TEST_GROUP_RETRY_POLICY.WHOLE_GROUP_ONCE) {
        return 1;
    }
    return retriesPerCaseFor(policy) * Math.max(1, caseCount);
}
