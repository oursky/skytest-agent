import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import {
    emitRunSessionTerminal,
    subscribeRunTerminal,
} from '@/lib/runners/domain-events';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { rollupRunSessionStatus } from '@/lib/runtime/run-session-status';
import { resolveLatestAttempts } from '@/lib/runtime/test-group-retry-plan';
import { collectLoginFlowIds } from '@/lib/test-cases/login-flow-access';
import {
    RUN_ACTIVE_STATUSES,
    RUN_SESSION_KIND,
    RUN_TERMINAL_STATUSES,
    TEST_CASE_KIND,
    TEST_GROUP_RETRY_POLICY,
    TEST_STATUS,
    isRunTerminalStatus,
    type BrowserConfig,
    type RunSessionKind,
    type RunTriggerSource,
    type RunStatus,
    type RunTerminalStatus,
    type TargetConfig,
    type TestGroupRetryPolicy,
} from '@/types';

const logger = createLogger('runtime:run-session-service');

export interface CreateRunSessionInput {
    projectId: string;
    kind?: RunSessionKind;
    testGroupId?: string | null;
    requiredCapability: string;
    triggeredByEmail?: string | null;
    triggerSource: RunTriggerSource;
    retryPolicy?: TestGroupRetryPolicy;
}

/**
 * Returns every valid login-flow id referenced by a test's browser targets, in target
 * order (deduped). A reference is valid only when it points at a LOGIN_FLOW test case in
 * the same project (re-validated here at run-build time, not just at save time). Each one
 * runs as its own login prefix before the test, so multiple browser sessions with
 * different login flows are all established in order.
 */
export async function resolveLoginFlowIds(
    projectId: string,
    browserConfig: Record<string, BrowserConfig | TargetConfig> | null | undefined,
): Promise<string[]> {
    const ids = collectLoginFlowIds(browserConfig);
    if (ids.length === 0) {
        return [];
    }
    const flows = await prisma.testCase.findMany({
        where: { id: { in: ids }, projectId, kind: TEST_CASE_KIND.LOGIN_FLOW },
        select: { id: true },
    });
    const valid = new Set(flows.map((flow) => flow.id));
    return ids.filter((id) => valid.has(id));
}

export async function createRunSession(
    input: CreateRunSessionInput,
    client: Pick<typeof prisma, 'runSession'> = prisma,
): Promise<string> {
    const retryPolicy = input.retryPolicy ?? TEST_GROUP_RETRY_POLICY.NONE;
    const session = await client.runSession.create({
        data: {
            projectId: input.projectId,
            kind: input.kind ?? RUN_SESSION_KIND.SINGLE,
            testGroupId: input.testGroupId ?? null,
            status: TEST_STATUS.QUEUED,
            requiredCapability: input.requiredCapability,
            triggeredByEmail: input.triggeredByEmail ?? null,
            triggerSource: input.triggerSource,
            retryPolicy,
            // Set up front rather than when the first round ends: the orchestrator must never
            // observe a window where the session can settle before its retries are planned.
            retryPending: retryPolicy !== TEST_GROUP_RETRY_POLICY.NONE,
        },
        select: { id: true },
    });
    return session.id;
}

const STARTED_STATUSES = new Set<string>([
    TEST_STATUS.PREPARING,
    TEST_STATUS.RUNNING,
    TEST_STATUS.PASS,
    TEST_STATUS.FAIL,
    TEST_STATUS.CANCELLED,
]);

// Each member status change recomputes the parent session (a full session + members
// reload). During the parallel login phase those fire O(members) times nearly at once,
// all reading the same rows. Coalesce concurrent recomputes per session into one in-flight
// pass plus a single trailing pass, so the work collapses to at most two reloads while the
// final (terminal) state is still always computed.
const runningRecompute = new Map<string, Promise<void>>();
const rerunRequested = new Set<string>();

/**
 * Recomputes a run session's aggregate status from its members and persists it.
 * Emits a session-terminal event when the session settles for the first time.
 * Concurrent calls for the same session coalesce (see runningRecompute above).
 */
export function recomputeRunSessionStatus(sessionId: string): Promise<void> {
    const existing = runningRecompute.get(sessionId);
    if (existing) {
        rerunRequested.add(sessionId);
        return existing;
    }
    const run = (async () => {
        try {
            do {
                rerunRequested.delete(sessionId);
                await performRunSessionRecompute(sessionId);
            } while (rerunRequested.has(sessionId));
        } finally {
            runningRecompute.delete(sessionId);
        }
    })();
    runningRecompute.set(sessionId, run);
    return run;
}

async function performRunSessionRecompute(sessionId: string): Promise<void> {
    const session = await prisma.runSession.findUnique({
        where: { id: sessionId },
        select: { id: true, kind: true, status: true, startedAt: true, projectId: true, retryPending: true },
    });
    if (!session) {
        return;
    }

    // A retried case has several attempt rows; only its latest one describes where the case
    // stands, so an earlier failed attempt must not hold the session at FAIL after a retry passed.
    const attempts = await prisma.testRun.findMany({
        where: { runSessionId: sessionId },
        select: { status: true, testCaseId: true, attempt: true, sessionPosition: true },
    });
    const members = resolveLatestAttempts(attempts);
    const nextStatus: RunStatus = rollupRunSessionStatus(
        members.map((member) => member.status),
        { retryPending: session.retryPending },
    );
    if (nextStatus === session.status) {
        return;
    }

    const now = new Date();

    if (isRunTerminalStatus(nextStatus)) {
        // Atomic terminal transition: only the first caller to flip a non-terminal
        // session to terminal performs the write and emits, so concurrent member
        // finalizes can't both observe a non-terminal session and double-emit the
        // session-terminal event.
        const updated = await prisma.runSession.updateMany({
            where: { id: sessionId, status: { notIn: [...RUN_TERMINAL_STATUSES] } },
            data: {
                status: nextStatus,
                ...(session.startedAt ? {} : { startedAt: now }),
                completedAt: now,
            },
        });
        if (updated.count === 1) {
            // A terminal session status tells the rest of the system execution is over
            // (inactive-run sweep, stop button, Slack notify), so record what settled it.
            const memberStatusCounts: Record<string, number> = {};
            for (const member of members) {
                memberStatusCounts[member.status] = (memberStatusCounts[member.status] ?? 0) + 1;
            }
            logger.info('Run session settled', { sessionId, status: nextStatus, memberStatusCounts });
            emitRunSessionTerminal({
                sessionId,
                status: nextStatus as RunTerminalStatus,
                kind: session.kind,
                projectId: session.projectId,
            });
        }
        return;
    }

    // Guarded like the terminal transition above, and for the same reason in reverse: a settled
    // session must stay settled. Retry rounds insert fresh QUEUED members into a session whose
    // members were all terminal moments earlier, so a stop landing in that gap can settle the
    // session and then meet those new rows. Without the guard the rollup would reopen a session
    // that had already reported its result, rewriting completedAt and emitting a second terminal.
    await prisma.runSession.updateMany({
        where: { id: sessionId, status: { notIn: [...RUN_TERMINAL_STATUSES] } },
        data: {
            status: nextStatus,
            ...(session.startedAt || !STARTED_STATUSES.has(nextStatus) ? {} : { startedAt: now }),
            completedAt: null,
        },
    });
}

export async function recomputeRunSessionForMember(runId: string): Promise<void> {
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: { runSessionId: true },
    });
    if (!run?.runSessionId) {
        return;
    }
    await recomputeRunSessionStatus(run.runSessionId);
}

/**
 * Drops a session's retry hold so the next recompute can settle it, reporting whether it was
 * actually holding. Every path that ends a session's execution must call this — the orchestrator
 * finishing its rounds, the stop button, and the stranded-session reaper — or the rollup guard
 * would keep a fully-terminal session RUNNING forever, permanently blocking the group from being
 * edited or re-run.
 */
export async function releaseSessionRetryHold(sessionId: string): Promise<boolean> {
    const released = await prisma.runSession.updateMany({
        where: { id: sessionId, retryPending: true },
        data: { retryPending: false },
    });
    return released.count > 0;
}

export const STRANDED_SESSION_REASON = 'Run session ended unexpectedly';

/**
 * Settles every still-active member of a session as FAILED. Used whenever a session's
 * in-process driver is gone — an orchestrator throw (reconcileStrandedSessionMembers) or a
 * crashed/restarted server (reapStrandedRunSessions). A session's later members never get
 * dispatched on their own (the dispatcher only claims the first member) and the per-run
 * reapers only touch PREPARING/RUNNING, so without this they would sit QUEUED forever.
 * Failing (rather than cancelling) makes the session roll up to FAIL, matching the outcome
 * of the fault that stranded it. Returns the number of members settled.
 *
 * A session stranded in the gap between retry rounds has no active members at all — only the
 * retry hold keeps it live — so this also recomputes when it released that hold but settled
 * nothing, otherwise such a session would stay RUNNING forever. `releasedRetryHold` lets callers
 * tell that apart from "nothing to do".
 */
export async function failActiveSessionMembers(
    sessionId: string,
    reason: string = STRANDED_SESSION_REASON,
): Promise<{ settledMembers: number; releasedRetryHold: boolean }> {
    const result = JSON.stringify({ status: TEST_STATUS.FAIL, error: reason, errorCode: 'SESSION_ABORTED', errorCategory: 'FAILED' });
    const active = await prisma.testRun.findMany({
        where: { runSessionId: sessionId, status: { in: [...RUN_ACTIVE_STATUSES] } },
        select: { id: true, testCaseId: true },
    });
    // The driver is gone, so no further retry round can run; release the hold before settling
    // members or the recompute below would leave the session RUNNING with nothing to advance it.
    const releasedRetryHold = await releaseSessionRetryHold(sessionId);
    const now = new Date();
    let settled = 0;
    for (const member of active) {
        const updated = await prisma.testRun.updateMany({
            where: { id: member.id, status: { in: [...RUN_ACTIVE_STATUSES] } },
            data: { status: TEST_STATUS.FAIL, error: reason, result, completedAt: now, assignedRunnerId: null, leaseExpiresAt: null },
        });
        if (updated.count > 0) {
            await prisma.testCase.update({ where: { id: member.testCaseId }, data: { status: TEST_STATUS.FAIL } }).catch(() => {});
            publishRunUpdate(member.id);
            settled += 1;
        }
    }
    if (settled > 0 || releasedRetryHold) {
        await recomputeRunSessionStatus(sessionId);
    }
    return { settledMembers: settled, releasedRetryHold };
}

let rollupSubscriberRegistered = false;

/**
 * Keeps RunSession.status in sync with member runs across every terminal path
 * (local browser lifecycle, runner protocol, queue sanitizer, lease reaper) by
 * recomputing the parent session whenever a member run reaches a terminal state.
 */
export function registerRunSessionRollupSubscriber(): void {
    if (rollupSubscriberRegistered) {
        return;
    }
    rollupSubscriberRegistered = true;
    subscribeRunTerminal((event) => {
        void recomputeRunSessionForMember(event.runId).catch((error) => {
            logger.warn('Failed to recompute run session after member terminal', {
                runId: event.runId,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    });
}
