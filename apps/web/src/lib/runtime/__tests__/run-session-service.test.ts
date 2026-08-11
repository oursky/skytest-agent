import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_STATUS } from '@/types';

/**
 * Covers the seam where the retry hold, the latest-attempt reduction and the rollup compose.
 * Each piece is verifiable on its own — the rollup is a pure function, the hold is one update —
 * but the bugs live in the wiring: passing every attempt instead of the latest, or forgetting to
 * pass `retryPending` at all, leaves both pieces individually correct and the session wrong.
 * So this drives the real functions against an in-memory RunSession + TestRun pair.
 */
interface SessionRow {
    id: string;
    kind: string;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
    projectId: string;
    retryPending: boolean;
}

interface RunRow {
    id: string;
    runSessionId: string;
    testCaseId: string;
    attempt: number;
    sessionPosition: number;
    status: string;
}

const mocks = vi.hoisted(() => ({
    emitRunSessionTerminal: vi.fn(),
    subscribeRunTerminal: vi.fn(),
    publishRunUpdate: vi.fn(),
}));

let session: SessionRow;
let runs: RunRow[];

function statusIn(filter: unknown, status: string): boolean {
    if (filter && typeof filter === 'object' && Array.isArray((filter as { in?: string[] }).in)) {
        return (filter as { in: string[] }).in.includes(status);
    }
    if (filter && typeof filter === 'object' && Array.isArray((filter as { notIn?: string[] }).notIn)) {
        return !(filter as { notIn: string[] }).notIn.includes(status);
    }
    return filter === undefined || filter === status;
}

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        runSession: {
            findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (
                where.id === session.id ? { ...session } : null
            )),
            update: vi.fn(async ({ data }: { data: Partial<SessionRow> }) => {
                Object.assign(session, data);
                return { ...session };
            }),
            updateMany: vi.fn(async ({ where, data }: {
                where: { id: string; status?: unknown; retryPending?: boolean };
                data: Partial<SessionRow>;
            }) => {
                const statusOk = statusIn(where.status, session.status);
                const holdOk = where.retryPending === undefined || where.retryPending === session.retryPending;
                if (where.id !== session.id || !statusOk || !holdOk) {
                    return { count: 0 };
                }
                Object.assign(session, data);
                return { count: 1 };
            }),
        },
        testRun: {
            findMany: vi.fn(async ({ where }: { where: { runSessionId: string; status?: unknown } }) => runs
                .filter((run) => run.runSessionId === where.runSessionId && statusIn(where.status, run.status))
                .map((run) => ({ ...run }))),
            updateMany: vi.fn(async ({ where, data }: {
                where: { id: string; status?: unknown };
                data: { status?: string };
            }) => {
                const run = runs.find((candidate) => candidate.id === where.id);
                if (!run || !statusIn(where.status, run.status)) {
                    return { count: 0 };
                }
                Object.assign(run, data);
                return { count: 1 };
            }),
        },
        testCase: { update: vi.fn(async () => ({})) },
    },
}));

vi.mock('@/lib/runners/domain-events', () => ({
    emitRunSessionTerminal: mocks.emitRunSessionTerminal,
    subscribeRunTerminal: mocks.subscribeRunTerminal,
}));
vi.mock('@/lib/runners/event-bus', () => ({ publishRunUpdate: mocks.publishRunUpdate }));

import {
    failActiveSessionMembers,
    recomputeRunSessionStatus,
    releaseSessionRetryHold,
} from '@/lib/runtime/run-session-service';

/** `attempts` is per case, in attempt order: seed('a', ['FAIL', 'PASS']) is one case retried once. */
function seed(options: { retryPending: boolean; cases: Record<string, string[]>; status?: string }): void {
    session = {
        id: 'session-1',
        kind: 'GROUP',
        status: options.status ?? TEST_STATUS.RUNNING,
        startedAt: new Date('2026-01-01T00:00:00Z'),
        completedAt: null,
        projectId: 'p1',
        retryPending: options.retryPending,
    };
    runs = [];
    Object.entries(options.cases).forEach(([testCaseId, statuses], position) => {
        statuses.forEach((status, index) => {
            runs.push({
                id: `${testCaseId}#${index + 1}`,
                runSessionId: session.id,
                testCaseId,
                attempt: index + 1,
                sessionPosition: position,
                status,
            });
        });
    });
}

beforeEach(() => vi.clearAllMocks());

describe('recomputeRunSessionStatus — retry hold', () => {
    it('holds a failed session non-terminal and emits nothing while retries are pending', async () => {
        seed({ retryPending: true, cases: { a: [TEST_STATUS.PASS], b: [TEST_STATUS.FAIL] } });

        await recomputeRunSessionStatus('session-1');

        expect(session.status).toBe(TEST_STATUS.RUNNING);
        expect(session.completedAt).toBeNull();
        expect(mocks.emitRunSessionTerminal).not.toHaveBeenCalled();
    });

    it('settles the same session once the hold is gone', async () => {
        seed({ retryPending: false, cases: { a: [TEST_STATUS.PASS], b: [TEST_STATUS.FAIL] } });

        await recomputeRunSessionStatus('session-1');

        expect(session.status).toBe(TEST_STATUS.FAIL);
        expect(session.completedAt).not.toBeNull();
        expect(mocks.emitRunSessionTerminal).toHaveBeenCalledTimes(1);
    });

    it('settles an all-pass session immediately even while the hold is set', async () => {
        seed({ retryPending: true, cases: { a: [TEST_STATUS.PASS], b: [TEST_STATUS.PASS] } });

        await recomputeRunSessionStatus('session-1');

        expect(session.status).toBe(TEST_STATUS.PASS);
        expect(mocks.emitRunSessionTerminal).toHaveBeenCalledTimes(1);
    });
});

describe('recomputeRunSessionStatus — retried cases', () => {
    it('passes once a failed case recovered on a later attempt', async () => {
        seed({ retryPending: false, cases: { a: [TEST_STATUS.PASS], b: [TEST_STATUS.FAIL, TEST_STATUS.PASS] } });

        await recomputeRunSessionStatus('session-1');

        expect(session.status).toBe(TEST_STATUS.PASS);
    });

    it('fails when the latest attempt is the failing one', async () => {
        seed({ retryPending: false, cases: { a: [TEST_STATUS.PASS], b: [TEST_STATUS.PASS, TEST_STATUS.FAIL] } });

        await recomputeRunSessionStatus('session-1');

        expect(session.status).toBe(TEST_STATUS.FAIL);
    });

    it('stays non-terminal while a fresh retry attempt is still queued', async () => {
        seed({ retryPending: true, cases: { a: [TEST_STATUS.PASS], b: [TEST_STATUS.FAIL, TEST_STATUS.QUEUED] } });

        await recomputeRunSessionStatus('session-1');

        expect(session.status).toBe(TEST_STATUS.RUNNING);
        expect(mocks.emitRunSessionTerminal).not.toHaveBeenCalled();
    });

    it('emits the terminal event only once across repeated recomputes', async () => {
        seed({ retryPending: false, cases: { a: [TEST_STATUS.FAIL] } });

        await recomputeRunSessionStatus('session-1');
        await recomputeRunSessionStatus('session-1');

        expect(mocks.emitRunSessionTerminal).toHaveBeenCalledTimes(1);
    });
});

describe('releaseSessionRetryHold', () => {
    it('clears the flag and reports that it was holding', async () => {
        seed({ retryPending: true, cases: { a: [TEST_STATUS.FAIL] } });

        expect(await releaseSessionRetryHold('session-1')).toBe(true);
        expect(session.retryPending).toBe(false);
    });

    it('reports false when the session was not holding, so callers can tell it apart', async () => {
        seed({ retryPending: false, cases: { a: [TEST_STATUS.FAIL] } });

        expect(await releaseSessionRetryHold('session-1')).toBe(false);
    });
});

describe('failActiveSessionMembers', () => {
    it('releases the hold before settling, so a session stranded between rounds still settles', async () => {
        // The exact shape of a crash between retry rounds: every attempt is terminal and only the
        // hold keeps the session alive, so there is no active member to settle.
        seed({ retryPending: true, cases: { a: [TEST_STATUS.PASS], b: [TEST_STATUS.FAIL] } });

        const outcome = await failActiveSessionMembers('session-1');

        expect(outcome).toEqual({ settledMembers: 0, releasedRetryHold: true });
        expect(session.status).toBe(TEST_STATUS.FAIL);
        expect(session.completedAt).not.toBeNull();
    });

    it('fails the members that were still active and settles the session', async () => {
        seed({ retryPending: false, cases: { a: [TEST_STATUS.PASS], b: [TEST_STATUS.RUNNING] } });

        const outcome = await failActiveSessionMembers('session-1');

        expect(outcome).toEqual({ settledMembers: 1, releasedRetryHold: false });
        expect(runs.find((run) => run.id === 'b#1')?.status).toBe(TEST_STATUS.FAIL);
        expect(session.status).toBe(TEST_STATUS.FAIL);
    });

    it('does nothing to a session that is already fully settled', async () => {
        seed({ retryPending: false, cases: { a: [TEST_STATUS.PASS] }, status: TEST_STATUS.PASS });

        const outcome = await failActiveSessionMembers('session-1');

        expect(outcome).toEqual({ settledMembers: 0, releasedRetryHold: false });
        expect(session.status).toBe(TEST_STATUS.PASS);
    });
});
