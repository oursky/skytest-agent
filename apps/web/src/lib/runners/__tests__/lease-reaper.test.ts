import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    findMany,
    updateManyRuns,
    updateManyTestCases,
    deleteManyLocks,
    findManySessions,
    emitRunTerminal,
    failActiveSessionMembers,
} = vi.hoisted(() => ({
    findMany: vi.fn(),
    updateManyRuns: vi.fn(),
    updateManyTestCases: vi.fn(),
    deleteManyLocks: vi.fn(),
    findManySessions: vi.fn(),
    emitRunTerminal: vi.fn(),
    failActiveSessionMembers: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        testRun: {
            findMany,
            updateMany: updateManyRuns,
        },
        testCase: {
            updateMany: updateManyTestCases,
        },
        androidResourceLock: {
            deleteMany: deleteManyLocks,
        },
        runSession: {
            findMany: findManySessions,
        },
    },
}));

vi.mock('@/lib/runners/domain-events', () => ({
    emitRunTerminal,
}));

vi.mock('@/lib/runtime/run-session-service', () => ({
    failActiveSessionMembers,
}));

const { reapExpiredRunnerLeases, reapStaleLocalBrowserRuns, reapStrandedRunSessions } = await import('@/lib/runners/lease-reaper');

describe('reapExpiredRunnerLeases', () => {
    beforeEach(() => {
        findMany.mockReset();
        updateManyRuns.mockReset();
        updateManyTestCases.mockReset();
        deleteManyLocks.mockReset();
        emitRunTerminal.mockReset();
    });

    it('requeues PREPARING runs and fails RUNNING runs when leases expire', async () => {
        const now = new Date('2026-03-07T05:00:00.000Z');
        findMany.mockResolvedValueOnce([
            { id: 'run-1', testCaseId: 'tc-1', status: 'PREPARING' },
            { id: 'run-2', testCaseId: 'tc-2', status: 'RUNNING' },
        ]);

        const result = await reapExpiredRunnerLeases(now);

        expect(updateManyRuns).toHaveBeenNthCalledWith(1, {
            where: {
                id: { in: ['run-1'] },
                status: 'PREPARING',
            },
            data: {
                status: 'QUEUED',
                error: 'Runner lease expired during preparation; run re-queued',
                assignedRunnerId: null,
                leaseExpiresAt: null,
                startedAt: null,
            },
        });
        expect(updateManyRuns).toHaveBeenNthCalledWith(2, {
            where: {
                id: { in: ['run-2'] },
                status: 'RUNNING',
            },
            data: {
                status: 'FAIL',
                error: 'Runner lease expired before completion',
                assignedRunnerId: null,
                leaseExpiresAt: null,
                completedAt: now,
            },
        });
        expect(updateManyTestCases).toHaveBeenNthCalledWith(1, {
            where: { id: { in: ['tc-1'] } },
            data: { status: 'QUEUED' },
        });
        expect(updateManyTestCases).toHaveBeenNthCalledWith(2, {
            where: { id: { in: ['tc-2'] } },
            data: { status: 'FAIL' },
        });
        expect(deleteManyLocks).toHaveBeenCalledWith({
            where: {
                OR: [
                    { leaseExpiresAt: { lte: now } },
                    {
                        run: {
                            deletedAt: { not: null },
                        },
                    },
                    {
                        run: {
                            status: { notIn: ['PREPARING', 'RUNNING'] },
                        },
                    },
                ],
            },
        });
        expect(result).toEqual({ recoveredRuns: 2, requeuedRuns: 1, failedRuns: 1 });
        expect(emitRunTerminal).toHaveBeenCalledWith({
            runId: 'run-2',
            status: 'FAIL',
            testCaseId: 'tc-2',
        });
    });

    it('does nothing when no expired runs are found', async () => {
        const now = new Date('2026-03-07T05:00:00.000Z');
        findMany.mockResolvedValueOnce([]);

        const result = await reapExpiredRunnerLeases(now);

        expect(updateManyRuns).not.toHaveBeenCalled();
        expect(updateManyTestCases).not.toHaveBeenCalled();
        expect(deleteManyLocks).toHaveBeenCalledWith({
            where: {
                OR: [
                    { leaseExpiresAt: { lte: now } },
                    {
                        run: {
                            deletedAt: { not: null },
                        },
                    },
                    {
                        run: {
                            status: { notIn: ['PREPARING', 'RUNNING'] },
                        },
                    },
                ],
            },
        });
        expect(emitRunTerminal).not.toHaveBeenCalled();
        expect(result).toEqual({ recoveredRuns: 0, requeuedRuns: 0, failedRuns: 0 });
    });
});

describe('reapStaleLocalBrowserRuns', () => {
    beforeEach(() => {
        findMany.mockReset();
        updateManyRuns.mockReset();
        updateManyTestCases.mockReset();
        deleteManyLocks.mockReset();
        emitRunTerminal.mockReset();
    });

    it('requeues PREPARING local browser runs and fails RUNNING local browser runs when stale', async () => {
        const now = new Date('2026-03-07T05:00:00.000Z');
        findMany.mockResolvedValueOnce([
            { id: 'run-3', testCaseId: 'tc-3', status: 'PREPARING' },
            { id: 'run-4', testCaseId: 'tc-4', status: 'RUNNING' },
        ]);

        const result = await reapStaleLocalBrowserRuns(now);

        expect(findMany).toHaveBeenCalledWith({
            where: {
                status: { in: ['PREPARING', 'RUNNING'] },
                deletedAt: null,
                assignedRunnerId: null,
                requiredCapability: 'BROWSER',
                OR: [
                    { lastEventAt: { lt: result.staleBefore } },
                    {
                        lastEventAt: null,
                        startedAt: { lt: result.staleBefore },
                    },
                ],
            },
            select: {
                id: true,
                testCaseId: true,
                status: true,
            },
        });
        expect(updateManyRuns).toHaveBeenNthCalledWith(1, {
            where: {
                id: { in: ['run-3'] },
                status: 'PREPARING',
                assignedRunnerId: null,
                requiredCapability: 'BROWSER',
            },
            data: {
                status: 'QUEUED',
                error: 'Local browser run became stale during preparation; run re-queued',
                startedAt: null,
            },
        });
        expect(updateManyRuns).toHaveBeenNthCalledWith(2, {
            where: {
                id: { in: ['run-4'] },
                status: 'RUNNING',
                assignedRunnerId: null,
                requiredCapability: 'BROWSER',
            },
            data: {
                status: 'FAIL',
                error: 'Local browser run became stale before completion',
                completedAt: now,
            },
        });
        expect(updateManyTestCases).toHaveBeenNthCalledWith(1, {
            where: { id: { in: ['tc-3'] } },
            data: { status: 'QUEUED' },
        });
        expect(updateManyTestCases).toHaveBeenNthCalledWith(2, {
            where: { id: { in: ['tc-4'] } },
            data: { status: 'FAIL' },
        });
        expect(result).toEqual({
            recoveredRuns: 2,
            requeuedRuns: 1,
            failedRuns: 1,
            staleBefore: result.staleBefore,
        });
        expect(emitRunTerminal).toHaveBeenCalledWith({
            runId: 'run-4',
            status: 'FAIL',
            testCaseId: 'tc-4',
        });
    });

    it('does nothing when no stale local browser run is found', async () => {
        const now = new Date('2026-03-07T05:00:00.000Z');
        findMany.mockResolvedValueOnce([]);

        const result = await reapStaleLocalBrowserRuns(now);

        expect(updateManyRuns).not.toHaveBeenCalled();
        expect(updateManyTestCases).not.toHaveBeenCalled();
        expect(emitRunTerminal).not.toHaveBeenCalled();
        expect(result).toEqual({
            recoveredRuns: 0,
            requeuedRuns: 0,
            failedRuns: 0,
            staleBefore: result.staleBefore,
        });
    });
});

describe('reapStrandedRunSessions', () => {
    beforeEach(() => {
        findManySessions.mockReset();
        failActiveSessionMembers.mockReset();
        failActiveSessionMembers.mockResolvedValue(0);
    });

    it('settles sessions whose members have all gone stale (driver crashed)', async () => {
        const now = new Date('2026-03-07T05:00:00.000Z');
        const stale = new Date(0);
        findManySessions.mockResolvedValueOnce([
            {
                id: 'session-stranded',
                memberRuns: [
                    { lastEventAt: stale, startedAt: stale },
                    { lastEventAt: null, startedAt: stale },
                ],
            },
        ]);
        failActiveSessionMembers.mockResolvedValueOnce(2);

        const result = await reapStrandedRunSessions(now);

        expect(failActiveSessionMembers).toHaveBeenCalledWith('session-stranded');
        expect(result).toEqual({ strandedSessions: 1, settledMembers: 2, staleBefore: result.staleBefore });
    });

    it('leaves sessions with recent activity alone (healthy driver)', async () => {
        const now = new Date('2026-03-07T05:00:00.000Z');
        findManySessions.mockResolvedValueOnce([
            {
                id: 'session-live',
                memberRuns: [
                    { lastEventAt: new Date(0), startedAt: new Date(0) },
                    { lastEventAt: now, startedAt: new Date(0) },
                ],
            },
        ]);

        const result = await reapStrandedRunSessions(now);

        expect(failActiveSessionMembers).not.toHaveBeenCalled();
        expect(result).toEqual({ strandedSessions: 0, settledMembers: 0, staleBefore: result.staleBefore });
    });

    it('does nothing when no candidate sessions exist', async () => {
        const now = new Date('2026-03-07T05:00:00.000Z');
        findManySessions.mockResolvedValueOnce([]);

        const result = await reapStrandedRunSessions(now);

        expect(failActiveSessionMembers).not.toHaveBeenCalled();
        expect(result).toEqual({ strandedSessions: 0, settledMembers: 0, staleBefore: result.staleBefore });
    });
});
