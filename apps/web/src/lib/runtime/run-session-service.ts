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
 * Returns the first valid login-flow id referenced by a test's browser config, or
 * null. A reference is valid only when it points at a LOGIN_FLOW test case in the
 * same project (re-validated here at run-build time, not just at save time).
 */
export async function resolveLoginFlowId(
    projectId: string,
    browserConfig: Record<string, BrowserConfig | TargetConfig> | null | undefined,
): Promise<string | null> {
    const ids = collectLoginFlowIds(browserConfig);
    if (ids.length === 0) {
        return null;
    }
    const flow = await prisma.testCase.findFirst({
        where: { id: { in: ids }, projectId, kind: TEST_CASE_KIND.LOGIN_FLOW },
        select: { id: true },
    });
    return flow?.id ?? null;
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

/**
 * Recomputes a run session's aggregate status from its members and persists it.
 * Emits a session-terminal event when the session settles for the first time.
 */
export async function recomputeRunSessionStatus(sessionId: string): Promise<void> {
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
    const becameTerminal = isRunTerminalStatus(nextStatus);
    await prisma.runSession.update({
        where: { id: sessionId },
        data: {
            status: nextStatus,
            ...(session.startedAt || !STARTED_STATUSES.has(nextStatus) ? {} : { startedAt: now }),
            completedAt: becameTerminal ? now : null,
        },
    });

    if (becameTerminal) {
        emitRunSessionTerminal({
            sessionId,
            status: nextStatus as RunTerminalStatus,
            kind: session.kind,
            projectId: session.projectId,
        });
    }
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
