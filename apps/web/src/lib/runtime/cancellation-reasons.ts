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
