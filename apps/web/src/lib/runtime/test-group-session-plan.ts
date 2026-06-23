import {
    TEST_GROUP_FAILURE_MODE,
    type TestGroupFailureMode,
    type TestCaseTargetSummary,
} from '@/types';

/**
 * Resolves which group login session a target reuses, by login-flow match plus the
 * target's reuse flag. Returns the login-flow id key of the session, or null when the
 * target is not reusing a session (no link, reuse off, or no baseline captured —
 * e.g. the login flow was deleted or its run failed).
 */
export function resolveTargetSessionLoginFlowId(
    target: { loginFlowId: string | null; reuseEnabled: boolean },
    availableLoginFlowIds: ReadonlySet<string>,
): string | null {
    if (!target.loginFlowId || !target.reuseEnabled) {
        return null;
    }
    return availableLoginFlowIds.has(target.loginFlowId) ? target.loginFlowId : null;
}

/** For a member's targets, the subset that should be seeded from a captured session baseline. */
export function planTargetStorageStateBindings(
    targets: TestCaseTargetSummary[],
    availableLoginFlowIds: ReadonlySet<string>,
): { targetKey: string; loginFlowId: string }[] {
    const bindings: { targetKey: string; loginFlowId: string }[] = [];
    for (const target of targets) {
        const loginFlowId = resolveTargetSessionLoginFlowId(target, availableLoginFlowIds);
        if (loginFlowId) {
            bindings.push({ targetKey: target.key, loginFlowId });
        }
    }
    return bindings;
}

/** Whether the group run should stop and skip the remaining cases after a non-pass member. */
export function shouldStopAfterFailure(mode: TestGroupFailureMode): boolean {
    return mode !== TEST_GROUP_FAILURE_MODE.CONTINUE;
}
