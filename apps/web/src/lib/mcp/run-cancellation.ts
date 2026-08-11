import { prisma } from '@/lib/core/prisma';
import { cancelActiveRunSession } from '@/lib/runtime/cancel-run';
import { RUN_ACTIVE_STATUSES, TEST_STATUS, isRunTerminalStatus } from '@/types';

export async function cancelRunDurably(runId: string, errorMessage: string): Promise<boolean> {
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            status: true,
            testCaseId: true,
        },
    });

    if (!run) {
        return false;
    }

    if (isRunTerminalStatus(run.status)) {
        return false;
    }

    const completedAt = new Date();
    const cancelled = await prisma.$transaction(async (tx) => {
        const updateResult = await tx.testRun.updateMany({
            where: {
                id: runId,
                status: { in: [...RUN_ACTIVE_STATUSES] },
            },
            data: {
                status: TEST_STATUS.CANCELLED,
                error: errorMessage,
                completedAt,
                assignedRunnerId: null,
                leaseExpiresAt: null,
            },
        });

        if (updateResult.count === 0) {
            return false;
        }

        await tx.testCase.update({
            where: { id: run.testCaseId },
            data: { status: TEST_STATUS.CANCELLED },
        });

        await tx.androidResourceLock.deleteMany({
            where: {
                runId,
            },
        });

        return true;
    });
    if (!cancelled) {
        return false;
    }

    return true;
}

export interface StopCandidate {
    id: string;
    runSessionId: string | null;
}

export interface StopOutcome {
    cancelledRunIds: string[];
    skipped: Array<{ runId: string; reason: string }>;
    failures: Array<{ runId: string; error: string }>;
    /**
     * Members stopped beyond the requested runs, because stopping any member of a run session stops
     * the session. Reported so a caller is told it stopped more than it named rather than finding
     * out later.
     */
    sessionMembersAlsoCancelled: number;
}

/**
 * Cancels a batch of runs on behalf of a stop tool, routing anything that belongs to a run session
 * through the session canceller.
 *
 * A per-run cancel settles the row but leaves the session's in-process driver untouched: the status
 * watcher only aborts that one member's controller, never the session's. For a group with a retry
 * policy the retry loop therefore keeps going, so the stop would settle what exists and then be
 * overtaken by attempt rows created immediately afterwards. Going through the session canceller
 * aborts the driver, releases the retry hold, and rolls the session up.
 *
 * Stopping one member stops its whole session, which is what the single-run HTTP cancel already
 * does: a session cannot be partially drained, since its driver decides what runs next. Members
 * stopped on top of the requested ones are counted in `sessionMembersAlsoCancelled`.
 */
export async function cancelRunsForStop(
    runs: readonly StopCandidate[],
    reason: string,
): Promise<StopOutcome> {
    const outcome: StopOutcome = {
        cancelledRunIds: [], skipped: [], failures: [], sessionMembersAlsoCancelled: 0,
    };
    const sessionIds = [...new Set(runs.map((run) => run.runSessionId).filter((id): id is string => !!id))];

    let cancelledMembersTotal = 0;
    for (const sessionId of sessionIds) {
        try {
            const { cancelledMembers } = await cancelActiveRunSession(sessionId, reason);
            cancelledMembersTotal += cancelledMembers;
        } catch (error) {
            for (const run of runs.filter((candidate) => candidate.runSessionId === sessionId)) {
                outcome.failures.push({ runId: run.id, error: error instanceof Error ? error.message : 'Unknown error' });
            }
        }
    }

    // The session canceller reports a count rather than which rows it touched, so read the outcome
    // back per requested run. That also covers a member that settled on its own mid-cancel.
    if (sessionIds.length > 0) {
        const failedRunIds = new Set(outcome.failures.map((failure) => failure.runId));
        const sessionRunIds = runs
            .filter((run) => run.runSessionId && !failedRunIds.has(run.id))
            .map((run) => run.id);
        const settled = await prisma.testRun.findMany({
            where: { id: { in: sessionRunIds } },
            select: { id: true, status: true },
        });
        for (const run of settled) {
            if (run.status === TEST_STATUS.CANCELLED) {
                outcome.cancelledRunIds.push(run.id);
            } else {
                outcome.skipped.push({ runId: run.id, reason: `Run settled ${run.status} instead of cancelling` });
            }
        }
        outcome.sessionMembersAlsoCancelled = Math.max(0, cancelledMembersTotal - outcome.cancelledRunIds.length);
    }

    for (const run of runs.filter((candidate) => !candidate.runSessionId)) {
        try {
            if (await cancelRunDurably(run.id, reason)) {
                outcome.cancelledRunIds.push(run.id);
            } else {
                outcome.skipped.push({ runId: run.id, reason: 'Run is no longer active' });
            }
        } catch (error) {
            outcome.failures.push({ runId: run.id, error: error instanceof Error ? error.message : 'Unknown error' });
        }
    }

    return outcome;
}

export interface AffectedSession {
    sessionId: string;
    kind: string;
    testGroupId: string | null;
    testGroupName: string | null;
    /** Requested runs that belong to this session. */
    requestedRunIds: string[];
    /** Active members the session has in total — the stop settles all of them, not just the requested ones. */
    activeMembers: number;
}

/**
 * Describes the run sessions a stop would take down, so a tool can confirm before acting.
 *
 * Stopping is session-wide, so a caller naming one queued case can end a whole test group. That is
 * the intent but not obvious from the request, which is why the stop tools ask first.
 */
export async function describeSessionsForStop(
    runs: readonly StopCandidate[],
): Promise<AffectedSession[]> {
    const requestedBySession = new Map<string, string[]>();
    for (const run of runs) {
        if (!run.runSessionId) {
            continue;
        }
        requestedBySession.set(run.runSessionId, [...(requestedBySession.get(run.runSessionId) ?? []), run.id]);
    }
    if (requestedBySession.size === 0) {
        return [];
    }

    const sessions = await prisma.runSession.findMany({
        where: { id: { in: [...requestedBySession.keys()] } },
        select: {
            id: true,
            kind: true,
            testGroupId: true,
            testGroup: { select: { name: true } },
            memberRuns: {
                where: { status: { in: [...RUN_ACTIVE_STATUSES] } },
                select: { id: true },
            },
        },
    });

    return sessions.map((session) => ({
        sessionId: session.id,
        kind: session.kind,
        testGroupId: session.testGroupId,
        testGroupName: session.testGroup?.name ?? null,
        requestedRunIds: requestedBySession.get(session.id) ?? [],
        activeMembers: session.memberRuns.length,
    }));
}

export type SessionStopResolution = 'stop_sessions' | 'only_standalone';

export interface StopGate {
    /** Present when the caller must confirm first; the tool should return it unchanged. */
    confirmation?: { message: string; details: Record<string, unknown> };
    /** Runs to actually stop once confirmed (or when nothing needed confirming). */
    targets: StopCandidate[];
    sessionsLeftRunning: AffectedSession[];
}

/**
 * Decides whether a stop can proceed. Because stopping is session-wide, a request naming one case
 * can end a whole test group, so the caller confirms that first — the same shape `update_test_case`
 * uses for its active-run confirmation, so an agent meets one pattern rather than two.
 */
export async function gateSessionStop(
    runs: readonly StopCandidate[],
    resolution: SessionStopResolution | undefined,
    context: Record<string, unknown>,
): Promise<StopGate> {
    const affected = await describeSessionsForStop(runs);
    if (affected.length === 0) {
        return { targets: [...runs], sessionsLeftRunning: [] };
    }

    if (resolution === undefined) {
        const groupNames = affected
            .map((session) => session.testGroupName)
            .filter((name): name is string => !!name);
        const groupSuffix = groupNames.length > 0 ? ` Test groups affected: ${groupNames.join(', ')}.` : '';
        return {
            confirmation: {
                message: 'Some of these runs belong to run sessions. A session cannot be stopped '
                    + 'partway, so stopping them also stops every other member of those sessions, '
                    + `including test group cases that are still running.${groupSuffix} `
                    + 'Confirm how to proceed.',
                details: {
                    ...context,
                    code: 'SESSION_STOP_CONFIRMATION_REQUIRED',
                    sessions: affected,
                    options: ['stop_sessions', 'only_standalone'],
                },
            },
            targets: [],
            sessionsLeftRunning: [],
        };
    }

    if (resolution === 'only_standalone') {
        return {
            targets: runs.filter((run) => !run.runSessionId),
            sessionsLeftRunning: affected,
        };
    }

    return { targets: [...runs], sessionsLeftRunning: [] };
}
