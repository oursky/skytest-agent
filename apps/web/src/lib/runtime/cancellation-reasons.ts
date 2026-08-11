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

const REASON_STRING_TO_CODE: Record<string, string> = Object.fromEntries(
    Object.entries(CANCELLATION_REASON).map(([code, message]) => [message, code]),
);

/**
 * Maps a CANCELLED run's persisted error string to its stable reason code (e.g. USER_SINGLE)
 * so API/MCP consumers can branch on a machine-readable reason instead of parsing prose.
 * Returns null for non-cancelled runs or unrecognized (dynamic/historical) messages.
 */
export function cancellationReasonCodeFor(status: string, error: string | null | undefined): string | null {
    if (status !== 'CANCELLED' || !error) {
        return null;
    }
    return REASON_STRING_TO_CODE[error] ?? null;
}

/** Reasons that mean a person stopped this run, rather than the orchestrator skipping it. */
const USER_INITIATED_CANCELLATION_CODES: ReadonlySet<string> = new Set([
    'USER_SINGLE',
    'USER_GROUP',
    'MCP',
    'MCP_FOR_UPDATE',
]);

/**
 * Whether a CANCELLED run was stopped deliberately by someone, as opposed to skipped by the group
 * (`EARLIER_CASE_FAILED`, `LOGIN_FLOW_FAILED`) or cancelled for a dynamic/historical reason.
 *
 * Retry planning needs the distinction: a case skipped behind a failure must still get its retries,
 * but a case someone stopped must not be re-run — otherwise stopping a group with a retry policy
 * just hands every cancelled case a fresh allowance. Unrecognized reasons stay retryable so the
 * skip-and-resume behavior is never weakened by an unmapped string.
 */
export function isUserInitiatedCancellation(status: string, error: string | null | undefined): boolean {
    const code = cancellationReasonCodeFor(status, error);
    return code !== null && USER_INITIATED_CANCELLATION_CODES.has(code);
}
