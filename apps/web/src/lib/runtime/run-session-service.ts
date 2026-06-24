import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import {
    emitRunSessionTerminal,
    subscribeRunTerminal,
} from '@/lib/runners/domain-events';
import { rollupRunSessionStatus } from '@/lib/runtime/run-session-status';
import { collectLoginFlowIds } from '@/lib/test-cases/login-flow-access';
import {
    RUN_SESSION_KIND,
    RUN_TERMINAL_STATUSES,
    TEST_CASE_KIND,
    TEST_STATUS,
    isRunTerminalStatus,
    type BrowserConfig,
    type RunSessionKind,
    type RunTriggerSource,
    type RunStatus,
    type RunTerminalStatus,
    type TargetConfig,
} from '@/types';

const logger = createLogger('runtime:run-session-service');

export interface CreateRunSessionInput {
    projectId: string;
    kind?: RunSessionKind;
    testGroupId?: string | null;
    requiredCapability: string;
    triggeredByEmail?: string | null;
    triggerSource: RunTriggerSource;
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

export async function createRunSession(input: CreateRunSessionInput): Promise<string> {
    const session = await prisma.runSession.create({
        data: {
            projectId: input.projectId,
            kind: input.kind ?? RUN_SESSION_KIND.SINGLE,
            testGroupId: input.testGroupId ?? null,
            status: TEST_STATUS.QUEUED,
            requiredCapability: input.requiredCapability,
            triggeredByEmail: input.triggeredByEmail ?? null,
            triggerSource: input.triggerSource,
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
        select: { id: true, kind: true, status: true, startedAt: true, projectId: true },
    });
    if (!session) {
        return;
    }

    const members = await prisma.testRun.findMany({
        where: { runSessionId: sessionId },
        select: { status: true },
    });
    const nextStatus: RunStatus = rollupRunSessionStatus(members.map((member) => member.status));
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
            emitRunSessionTerminal({
                sessionId,
                status: nextStatus as RunTerminalStatus,
                kind: session.kind,
                projectId: session.projectId,
            });
        }
        return;
    }

    await prisma.runSession.update({
        where: { id: sessionId },
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
