import { TEST_STATUS, type RunStatus } from '@/types';

/**
 * Derives the aggregate status of a run session from its member run statuses.
 *
 * A session stays live while any member could still execute: executing members
 * keep it RUNNING, and queued members keep it QUEUED (nothing started yet) or
 * RUNNING (partially settled). It must not settle early — a terminal session
 * status tells the rest of the system (the inactive-run sweep, the stop button,
 * completion events) that execution is over, and a CONTINUE-mode group keeps
 * running members after a failure. Only once every member has settled does a
 * failure decide FAIL, then a cancellation CANCELLED; a session that reaches
 * "all settled, no failures, no cancellations" is necessarily a pass.
 *
 * `retryPending` keeps a would-be-FAIL session live through the gap between retry rounds, when
 * every member is terminal but the orchestrator is about to create the next round's attempts.
 * Without it the session would settle there — emitting the terminal event, posting the Slack
 * summary, and releasing the group's edit lock before the retries had run. PASS and CANCELLED
 * still settle immediately: an all-pass group has nothing to retry, and a user-cancelled one
 * must not retry.
 *
 * Pass the statuses of the latest attempt per case, not every attempt, or an earlier failed
 * attempt would hold the session at FAIL after its retry passed.
 */
export function rollupRunSessionStatus(
    memberStatuses: readonly string[],
    options?: { retryPending?: boolean },
): RunStatus {
    if (memberStatuses.length === 0) {
        return TEST_STATUS.QUEUED;
    }
    if (memberStatuses.some((status) => status === TEST_STATUS.PREPARING || status === TEST_STATUS.RUNNING)) {
        return TEST_STATUS.RUNNING;
    }
    if (memberStatuses.some((status) => status === TEST_STATUS.QUEUED)) {
        return memberStatuses.every((status) => status === TEST_STATUS.QUEUED)
            ? TEST_STATUS.QUEUED
            : TEST_STATUS.RUNNING;
    }
    if (memberStatuses.some((status) => status === TEST_STATUS.FAIL)) {
        return options?.retryPending ? TEST_STATUS.RUNNING : TEST_STATUS.FAIL;
    }
    if (memberStatuses.some((status) => status === TEST_STATUS.CANCELLED)) {
        return TEST_STATUS.CANCELLED;
    }
    return TEST_STATUS.PASS;
}
