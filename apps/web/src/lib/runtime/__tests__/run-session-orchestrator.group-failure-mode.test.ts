import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_CASE_KIND } from '@/types';

const mocks = vi.hoisted(() => ({
    runSessionFindUnique: vi.fn(),
    testGroupFindUnique: vi.fn(),
    testRunFindMany: vi.fn(),
    testRunUpdateMany: vi.fn(),
    testRunFindUnique: vi.fn(),
    testCaseUpdate: vi.fn(),
    loadRunConfig: vi.fn(),
    runTest: vi.fn(),
    finalizeMemberRunResult: vi.fn(),
    finalizeMemberRunError: vi.fn(),
    recomputeRunSessionForMember: vi.fn(),
    failActiveSessionMembers: vi.fn(),
    publishRunUpdate: vi.fn(),
    emitRunTerminal: vi.fn(),
    updateRunStatusWithOwnership: vi.fn(),
    failRunWithoutTestCase: vi.fn(),
    createRunEventSink: vi.fn(),
    createRunStatusWatcher: vi.fn(),
    touchRunActivity: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        runSession: { findUnique: mocks.runSessionFindUnique },
        testGroup: { findUnique: mocks.testGroupFindUnique },
        testRun: {
            findMany: mocks.testRunFindMany,
            updateMany: mocks.testRunUpdateMany,
            findUnique: mocks.testRunFindUnique,
        },
        testCase: { update: mocks.testCaseUpdate },
    },
}));

vi.mock('@/lib/runtime/run-config-loader', () => ({ loadRunConfig: mocks.loadRunConfig }));
vi.mock('@/lib/runtime/test-runner', () => ({
    runTest: mocks.runTest,
    setupExecutionTargets: vi.fn(),
    cleanupTargets: vi.fn(),
    executeUnit: vi.fn(),
}));
vi.mock('@/lib/runtime/run-member-finalize', () => ({
    finalizeMemberRunResult: mocks.finalizeMemberRunResult,
    finalizeMemberRunError: mocks.finalizeMemberRunError,
}));
vi.mock('@/lib/runtime/run-session-service', () => ({
    recomputeRunSessionForMember: mocks.recomputeRunSessionForMember,
    failActiveSessionMembers: mocks.failActiveSessionMembers,
}));
vi.mock('@/lib/runners/event-bus', () => ({ publishRunUpdate: mocks.publishRunUpdate }));
vi.mock('@/lib/runners/domain-events', () => ({ emitRunTerminal: mocks.emitRunTerminal }));
vi.mock('@/lib/runtime/local-browser-runner-lifecycle', () => ({
    updateRunStatusWithOwnership: mocks.updateRunStatusWithOwnership,
    createLeaseExpiry: vi.fn(() => new Date()),
    withLoginFlowBrowserSlot: (fn: () => unknown) => fn(),
    failRunWithoutTestCase: mocks.failRunWithoutTestCase,
}));
vi.mock('@/lib/runtime/run-event-sink', () => ({
    createRunEventSink: mocks.createRunEventSink,
    createRunStatusWatcher: mocks.createRunStatusWatcher,
    touchRunActivity: mocks.touchRunActivity,
}));

import { executeGroupSession } from '@/lib/runtime/run-session-orchestrator';
import { CANCELLATION_REASON } from '@/lib/runtime/cancellation-reasons';

type MemberOutcome = 'PASS' | 'FAIL';

/** Runs a 3-case group session with the given failure mode and per-case runTest outcomes. */
async function runGroup(mode: 'STOP' | 'CONTINUE', outcomes: Record<string, MemberOutcome>) {
    mocks.runSessionFindUnique.mockResolvedValue({ testGroupId: 'group-1' });
    mocks.testGroupFindUnique.mockResolvedValue({ onFailure: mode });
    mocks.testRunFindMany.mockResolvedValue(
        Object.keys(outcomes).map((id, index) => ({
            id,
            sessionPosition: index,
            testCaseId: `tc-${id}`,
            kind: TEST_CASE_KIND.TEST,
            reusedSession: false,
        })),
    );
    mocks.testRunUpdateMany.mockResolvedValue({ count: 1 });
    mocks.testCaseUpdate.mockResolvedValue({});
    mocks.loadRunConfig.mockImplementation(async (runId: string) => ({
        runId,
        projectId: 'p1',
        testCaseId: `tc-${runId}`,
        usage: { actorUserId: 'u1', description: 'desc' },
        config: { url: 'https://example.com', browserConfig: {} },
    }));
    mocks.runTest.mockImplementation(async (input: { runId: string }) => ({ status: outcomes[input.runId] }));
    mocks.createRunEventSink.mockReturnValue({
        handleTestEvent: vi.fn(),
        queueEvent: vi.fn(),
        flush: vi.fn().mockResolvedValue(undefined),
        settleUploads: vi.fn().mockResolvedValue(undefined),
    });
    // Fire onInactive as soon as the watcher starts — this reproduces the real watcher
    // detecting its member going inactive. With the fix it aborts only the per-member
    // controller; the pre-fix code aborted the shared session controller here and cancelled
    // every later case as USER_GROUP, which these assertions would catch.
    mocks.createRunStatusWatcher.mockImplementation((
        _runId: string,
        _signal: AbortSignal,
        onInactive: () => void,
    ) => ({ start: () => onInactive(), stop: vi.fn() }));

    await executeGroupSession('session-1', new AbortController());
}

/** run ids that runTest actually executed. */
function ranMembers(): string[] {
    return mocks.runTest.mock.calls.map((call) => (call[0] as { runId: string }).runId);
}

/** run ids that were cancelled, with the reason recorded. */
function cancelledMembers(): { id: string; reason: string }[] {
    return mocks.testRunUpdateMany.mock.calls
        .map((call) => call[0] as { where: { id: string }; data: { status: string; error?: string } })
        .filter((arg) => arg.data.status === 'CANCELLED')
        .map((arg) => ({ id: arg.where.id, reason: arg.data.error ?? '' }));
}

describe('executeGroupSession failure mode', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it('CONTINUE: runs every remaining case after a mid-group failure and cancels none', async () => {
        await runGroup('CONTINUE', { m1: 'PASS', m2: 'FAIL', m3: 'PASS' });

        expect(ranMembers()).toEqual(['m1', 'm2', 'm3']);
        expect(cancelledMembers()).toEqual([]);
    });

    it('STOP: skips remaining cases after a failure and cancels them as EARLIER_CASE_FAILED', async () => {
        await runGroup('STOP', { m1: 'PASS', m2: 'FAIL', m3: 'PASS' });

        expect(ranMembers()).toEqual(['m1', 'm2']);
        expect(cancelledMembers()).toEqual([
            { id: 'm3', reason: CANCELLATION_REASON.EARLIER_CASE_FAILED },
        ]);
    });

    it('STOP: runs all cases and cancels none when every case passes', async () => {
        await runGroup('STOP', { m1: 'PASS', m2: 'PASS', m3: 'PASS' });

        expect(ranMembers()).toEqual(['m1', 'm2', 'm3']);
        expect(cancelledMembers()).toEqual([]);
    });

    it('CONTINUE: a failure in one case never cancels a sibling (isolation regression guard)', async () => {
        await runGroup('CONTINUE', { m1: 'FAIL', m2: 'FAIL', m3: 'FAIL' });

        expect(ranMembers()).toEqual(['m1', 'm2', 'm3']);
        expect(cancelledMembers()).toEqual([]);
    });
});
