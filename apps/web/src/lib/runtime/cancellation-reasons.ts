/**
 * Human-facing explanations shown in the run viewer when a run settles CANCELLED.
 * Kept in one place so every cancel path — a stopped standalone run, a stopped test
 * group, the MCP integration, and the orchestrator's "skip the rest" logic — speaks
 * with the same, plainer voice instead of a terse "Cancelled by user".
 */
export const CANCELLATION_REASON = {
    USER_SINGLE: 'This test run was stopped manually.',
    USER_GROUP: 'This run was stopped when its test group was stopped.',
    MCP: 'This run was stopped from the MCP integration.',
    MCP_FOR_UPDATE: 'This run was stopped from the MCP integration to apply a test case update.',
    LOGIN_FLOW_FAILED: 'This test did not run because a login flow in the group failed before it.',
    EARLIER_CASE_FAILED: 'This test did not run because an earlier test case in the group failed.',
} as const;

/**
 * Maps each canonical (English) cancellation reason to its i18n key so the run viewer
 * can render the reason in the user's locale. The English string stays the persisted /
 * MCP-facing value (and the fallback for historical runs); the viewer reverse-looks-up
 * the key from the stored string via localizeCancellationReason.
 */
const CANCELLATION_REASON_I18N_KEY: Record<string, string> = {
    [CANCELLATION_REASON.USER_SINGLE]: 'run.cancellation.userSingle',
    [CANCELLATION_REASON.USER_GROUP]: 'run.cancellation.userGroup',
    [CANCELLATION_REASON.MCP]: 'run.cancellation.mcp',
    [CANCELLATION_REASON.MCP_FOR_UPDATE]: 'run.cancellation.mcpForUpdate',
    [CANCELLATION_REASON.LOGIN_FLOW_FAILED]: 'run.cancellation.loginFlowFailed',
    [CANCELLATION_REASON.EARLIER_CASE_FAILED]: 'run.cancellation.earlierCaseFailed',
};

/**
 * Resolves a persisted cancellation reason string to its localized text, falling back to
 * the original string (e.g. a dynamic login-flow message with a link, or a historical run).
 */
export function localizeCancellationReason(reason: string | null | undefined, t: (key: string) => string): string | null {
    if (!reason) {
        return null;
    }
    const key = CANCELLATION_REASON_I18N_KEY[reason];
    return key ? t(key) : reason;
}
