import { describe, expect, it } from 'vitest';
import {
    planTargetStorageStateBindings,
    resolveTargetSessionLoginFlowId,
    shouldStopAfterFailure,
} from '@/lib/runtime/test-group-session-plan';
import { TEST_GROUP_FAILURE_MODE, type TestCaseTargetSummary } from '@/types';

const browserTarget = (over: Partial<TestCaseTargetSummary>): TestCaseTargetSummary => ({
    key: 'browser_1',
    label: 'Browser A',
    kind: 'browser',
    loginFlowId: null,
    reuseEnabled: false,
    ...over,
});

describe('resolveTargetSessionLoginFlowId', () => {
    it('maps when the login flow has a baseline and reuse is enabled', () => {
        const target = browserTarget({ loginFlowId: 'lf1', reuseEnabled: true });
        expect(resolveTargetSessionLoginFlowId(target, new Set(['lf1']))).toBe('lf1');
    });

    it('returns null when reuse is disabled', () => {
        const target = browserTarget({ loginFlowId: 'lf1', reuseEnabled: false });
        expect(resolveTargetSessionLoginFlowId(target, new Set(['lf1']))).toBeNull();
    });

    it('returns null when no login flow is linked', () => {
        const target = browserTarget({ loginFlowId: null, reuseEnabled: true });
        expect(resolveTargetSessionLoginFlowId(target, new Set(['lf1']))).toBeNull();
    });

    it('returns null when the login flow has no captured baseline (deleted/failed)', () => {
        const target = browserTarget({ loginFlowId: 'lf-missing', reuseEnabled: true });
        expect(resolveTargetSessionLoginFlowId(target, new Set(['lf1']))).toBeNull();
    });
});

describe('planTargetStorageStateBindings', () => {
    it('binds only the reusing targets with a captured baseline', () => {
        const targets: TestCaseTargetSummary[] = [
            browserTarget({ key: 'a', loginFlowId: 'lf1', reuseEnabled: true }),
            browserTarget({ key: 'b', loginFlowId: 'lf2', reuseEnabled: false }),
            browserTarget({ key: 'c', loginFlowId: null, reuseEnabled: true }),
            { key: 'd', label: 'Android', kind: 'android', loginFlowId: null, reuseEnabled: false },
        ];
        expect(planTargetStorageStateBindings(targets, new Set(['lf1', 'lf2']))).toEqual([
            { targetKey: 'a', loginFlowId: 'lf1' },
        ]);
    });
});

describe('shouldStopAfterFailure', () => {
    it('stops on STOP mode', () => {
        expect(shouldStopAfterFailure(TEST_GROUP_FAILURE_MODE.STOP)).toBe(true);
    });
    it('continues on CONTINUE mode', () => {
        expect(shouldStopAfterFailure(TEST_GROUP_FAILURE_MODE.CONTINUE)).toBe(false);
    });
});
