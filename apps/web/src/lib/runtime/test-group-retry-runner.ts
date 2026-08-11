import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import {
    buildCaseRetryStates,
    maxRetryRoundsFor,
    planRetryRound,
    retryPolicyRunsRetries,
    type AttemptRecord,
    type CaseRetryState,
} from '@/lib/runtime/test-group-retry-plan';
import {
    TEST_STATUS,
    type TestGroupFailureMode,
    type TestGroupRetryPolicy,
} from '@/types';

const logger = createLogger('runtime:test-group-retry-runner');

/** One executable member of a run session — a single attempt of one case. */
export interface SessionMember {
    id: string;
    sessionPosition: number | null;
    testCaseId: string;
    kind: string;
    reusedSession: boolean;
}

export interface RetryRoundsOptions {
    sessionId: string;
    retryPolicy: TestGroupRetryPolicy;
    failureMode: TestGroupFailureMode;
    signal: AbortSignal;
    /** Executes one round's members under the group's normal execution and failure rules. */
    runRound: (members: SessionMember[]) => Promise<void>;
    /** Called before each round starts, so the caller can reset per-round state (login baselines). */
    onRoundStart?: (roundIndex: number) => void;
}

/**
 * Drives retry rounds until the plan comes back empty. Each round re-reads the session's attempts
 * so the per-case budget is derived from what actually executed, which keeps it correct across a
 * round that cancelled members rather than running them.
 *
 * Three things end the loop: an empty plan (the normal exit), a round that produced no new
 * execution, and a hard round ceiling. The last two are backstops — see test-group-retry-plan.ts.
 */
export async function runGroupRetryRounds(options: RetryRoundsOptions): Promise<void> {
    const { sessionId, retryPolicy, failureMode, signal, runRound, onRoundStart } = options;
    if (!retryPolicyRunsRetries(retryPolicy)) {
        return;
    }

    for (let roundIndex = 0; ; roundIndex += 1) {
        if (signal.aborted) {
            return;
        }
        const cases = buildCaseRetryStates(await loadSessionAttempts(sessionId));
        if (roundIndex >= maxRetryRoundsFor(retryPolicy, cases.length)) {
            logger.warn('Test group retry rounds hit the safety ceiling', { sessionId, retryPolicy, roundIndex });
            return;
        }
        const plan = planRetryRound(cases, retryPolicy, failureMode, roundIndex);
        if (plan.length === 0) {
            return;
        }

        const executedBefore = totalExecuted(cases);
        const retryMembers = await createRetryAttempts(sessionId, plan);
        if (retryMembers.length === 0) {
            return;
        }
        logger.info('Starting test group retry round', {
            sessionId,
            retryPolicy,
            roundIndex,
            caseIds: plan.map((state) => state.testCaseId),
        });

        onRoundStart?.(roundIndex);
        await runRound(retryMembers);

        const executedAfter = totalExecuted(buildCaseRetryStates(await loadSessionAttempts(sessionId)));
        if (executedAfter === executedBefore) {
            logger.warn('Test group retry round executed nothing; stopping retries', { sessionId, roundIndex });
            return;
        }
    }
}

function totalExecuted(cases: readonly CaseRetryState[]): number {
    return cases.reduce((total, state) => total + state.executed, 0);
}

/**
 * Materializes the next attempt of each planned case as a fresh QUEUED run, so the failed attempt
 * keeps its own events, screenshots, and error trace. Attempts reuse the case's original
 * sessionPosition — display order and per-case grouping both key off it, and the dispatcher cannot
 * claim them because the session already has settled members.
 */
async function createRetryAttempts(
    sessionId: string,
    plan: readonly CaseRetryState[],
): Promise<SessionMember[]> {
    const previous = await prisma.testRun.findMany({
        where: { runSessionId: sessionId, testCaseId: { in: plan.map((state) => state.testCaseId) } },
        orderBy: { attempt: 'desc' },
        select: {
            testCaseId: true,
            attempt: true,
            requiredCapability: true,
            triggeredByEmail: true,
            triggerSource: true,
        },
    });
    const latestByCase = new Map<string, typeof previous[number]>();
    for (const run of previous) {
        if (!latestByCase.has(run.testCaseId)) {
            latestByCase.set(run.testCaseId, run);
        }
    }

    const created: SessionMember[] = [];
    for (const state of plan) {
        const source = latestByCase.get(state.testCaseId);
        if (!source) {
            continue;
        }
        const run = await prisma.testRun.create({
            data: {
                testCaseId: state.testCaseId,
                runSessionId: sessionId,
                sessionPosition: state.sessionPosition,
                attempt: source.attempt + 1,
                kind: state.kind,
                status: TEST_STATUS.QUEUED,
                requiredCapability: source.requiredCapability,
                triggeredByEmail: source.triggeredByEmail,
                triggerSource: source.triggerSource,
            },
            select: { id: true, sessionPosition: true, testCaseId: true, kind: true, reusedSession: true },
        });
        created.push(run);
    }
    return created;
}

async function loadSessionAttempts(sessionId: string): Promise<AttemptRecord[]> {
    return prisma.testRun.findMany({
        where: { runSessionId: sessionId },
        select: { testCaseId: true, kind: true, sessionPosition: true, attempt: true, status: true },
    });
}
