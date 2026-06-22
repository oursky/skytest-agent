import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import {
    emitRunSessionTerminal,
    subscribeRunTerminal,
} from '@/lib/runners/domain-events';
import { rollupRunSessionStatus } from '@/lib/runtime/run-session-status';
import {
    RUN_SESSION_KIND,
    TEST_STATUS,
    isRunTerminalStatus,
    type RunSessionKind,
    type RunTriggerSource,
    type RunStatus,
    type RunTerminalStatus,
} from '@/types';

const logger = createLogger('runtime:run-session-service');

export interface CreateRunSessionInput {
    projectId: string;
    kind?: RunSessionKind;
    requiredCapability: string;
    triggeredByEmail?: string | null;
    triggerSource: RunTriggerSource;
}

export async function createRunSession(input: CreateRunSessionInput): Promise<string> {
    const session = await prisma.runSession.create({
        data: {
            projectId: input.projectId,
            kind: input.kind ?? RUN_SESSION_KIND.SINGLE,
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
