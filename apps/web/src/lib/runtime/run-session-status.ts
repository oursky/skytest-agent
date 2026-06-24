import { TEST_STATUS, type RunStatus } from '@/types';

/**
 * Derives the aggregate status of a run session from its member run statuses.
 *
 * Priority: a single failure or cancellation decides the whole session; any
 * member still executing keeps the session RUNNING; otherwise the session is
 * QUEUED (nothing started) or PASS (every member settled without failure).
 * Members that never run are CANCELLED, and a failure outranks a cancellation,
 * so a session that reaches "all settled, no failures" is necessarily a pass.
 */
export function rollupRunSessionStatus(memberStatuses: readonly string[]): RunStatus {
    if (memberStatuses.length === 0) {
        return TEST_STATUS.QUEUED;
    }
    if (memberStatuses.some((status) => status === TEST_STATUS.FAIL)) {
        return TEST_STATUS.FAIL;
    }
    if (memberStatuses.some((status) => status === TEST_STATUS.CANCELLED)) {
        return TEST_STATUS.CANCELLED;
    }
    if (memberStatuses.some((status) => status === TEST_STATUS.PREPARING || status === TEST_STATUS.RUNNING)) {
        return TEST_STATUS.RUNNING;
    }
    if (memberStatuses.some((status) => status === TEST_STATUS.QUEUED)) {
        return memberStatuses.every((status) => status === TEST_STATUS.QUEUED)
            ? TEST_STATUS.QUEUED
            : TEST_STATUS.RUNNING;
    }
    return TEST_STATUS.PASS;
}
