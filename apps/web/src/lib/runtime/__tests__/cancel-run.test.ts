import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_STATUS } from '@/types';

/**
 * The stop button is one of the three paths that must release the retry hold, and the only one a
 * user drives. Releasing it *before* the rollup is what lets a group stopped in the gap between
 * retry rounds settle immediately instead of sitting RUNNING until the stranded-session reaper
 * notices, so the ordering is asserted here, not just the call.
 */
const mocks = vi.hoisted(() => ({
    runSessionFindUnique: vi.fn(),
    cancelActiveTestRun: vi.fn(),
    cancelLocalBrowserRun: vi.fn(),
    releaseSessionRetryHold: vi.fn(),
    recomputeRunSessionStatus: vi.fn(),
    publishRunUpdate: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: { runSession: { findUnique: mocks.runSessionFindUnique } },
}));
vi.mock('@/lib/runners/event-bus', () => ({ publishRunUpdate: mocks.publishRunUpdate }));
vi.mock('@/lib/runtime/run-session-service', () => ({
    recomputeRunSessionStatus: mocks.recomputeRunSessionStatus,
    releaseSessionRetryHold: mocks.releaseSessionRetryHold,
}));
vi.mock('@/lib/runtime/local-browser-runner', () => ({
    cancelLocalBrowserRun: mocks.cancelLocalBrowserRun,
}));

import { cancelActiveRunSession } from '@/lib/runtime/cancel-run';

let callOrder: string[];

beforeEach(() => {
    vi.clearAllMocks();
    callOrder = [];
    mocks.releaseSessionRetryHold.mockImplementation(async () => {
        callOrder.push('release');
        return true;
    });
    mocks.recomputeRunSessionStatus.mockImplementation(async () => {
        callOrder.push('recompute');
    });
});

describe('cancelActiveRunSession', () => {
    it('releases the retry hold before rolling the session up', async () => {
        mocks.runSessionFindUnique.mockResolvedValue({
            kind: 'GROUP',
            memberRuns: [
                { id: 'a#1', status: TEST_STATUS.PASS },
                { id: 'b#1', status: TEST_STATUS.FAIL },
            ],
        });

        await cancelActiveRunSession('session-1');

        expect(mocks.releaseSessionRetryHold).toHaveBeenCalledWith('session-1');
        expect(callOrder).toEqual(['release', 'recompute']);
    });

    it('still releases the hold when there was no active member left to cancel', async () => {
        // A group stopped in the gap between retry rounds: nothing is active, so without the
        // release the rollup would leave it RUNNING and the group locked.
        mocks.runSessionFindUnique.mockResolvedValue({
            kind: 'GROUP',
            memberRuns: [{ id: 'a#1', status: TEST_STATUS.FAIL }],
        });

        const result = await cancelActiveRunSession('session-1');

        expect(result).toEqual({ cancelledMembers: 0 });
        expect(callOrder).toEqual(['release', 'recompute']);
    });

    it('releases the hold even for a session that no longer exists', async () => {
        mocks.runSessionFindUnique.mockResolvedValue(null);

        await cancelActiveRunSession('session-1');

        expect(callOrder).toEqual(['release', 'recompute']);
    });
});
