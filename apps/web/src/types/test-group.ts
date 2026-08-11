export const TEST_GROUP_FAILURE_MODE = {
    STOP: 'STOP',
    CONTINUE: 'CONTINUE',
} as const;

export type TestGroupFailureMode = typeof TEST_GROUP_FAILURE_MODE[keyof typeof TEST_GROUP_FAILURE_MODE];

export const TEST_GROUP_EXECUTION_MODE = {
    SEQUENTIAL: 'SEQUENTIAL',
    PARALLEL: 'PARALLEL',
} as const;

export type TestGroupExecutionMode = typeof TEST_GROUP_EXECUTION_MODE[keyof typeof TEST_GROUP_EXECUTION_MODE];

/**
 * Retry budgets are per case, not per group: FAILED_ONCE/FAILED_TWICE allow each case that many
 * retries of its own, so a case first executed during a retry round still gets its full
 * allowance. WHOLE_GROUP_ONCE is always exactly one extra pass over every case.
 */
export const TEST_GROUP_RETRY_POLICY = {
    NONE: 'NONE',
    FAILED_ONCE: 'FAILED_ONCE',
    FAILED_TWICE: 'FAILED_TWICE',
    WHOLE_GROUP_ONCE: 'WHOLE_GROUP_ONCE',
} as const;

export type TestGroupRetryPolicy = typeof TEST_GROUP_RETRY_POLICY[keyof typeof TEST_GROUP_RETRY_POLICY];

export const TEST_GROUP_RETRY_POLICIES: readonly TestGroupRetryPolicy[] = [
    TEST_GROUP_RETRY_POLICY.NONE,
    TEST_GROUP_RETRY_POLICY.FAILED_ONCE,
    TEST_GROUP_RETRY_POLICY.FAILED_TWICE,
    TEST_GROUP_RETRY_POLICY.WHOLE_GROUP_ONCE,
];

export function coerceTestGroupRetryPolicy(value: string | null | undefined): TestGroupRetryPolicy {
    return TEST_GROUP_RETRY_POLICIES.includes(value as TestGroupRetryPolicy)
        ? value as TestGroupRetryPolicy
        : TEST_GROUP_RETRY_POLICY.NONE;
}

export interface TestGroupLoginSessionSummary {
    id: string;
    loginFlowId: string;
    name: string;
    position: number;
    displayId?: string | null;
    flowName: string;
}

export interface TestCaseTargetSummary {
    key: string;
    label: string;
    kind: 'browser' | 'android';
    loginFlowId: string | null;
    reuseEnabled: boolean;
}

export interface TestGroupItemSummary {
    testCaseId: string;
    position: number;
    displayId?: string | null;
    name: string;
    reuseGroupSession?: boolean;
}

export interface TestGroupSummary {
    id: string;
    name: string;
    displayId?: string | null;
    onFailure: TestGroupFailureMode;
    executionMode: TestGroupExecutionMode;
    retryPolicy: TestGroupRetryPolicy;
    loginSessions: TestGroupLoginSessionSummary[];
    items: TestGroupItemSummary[];
    lastSessionId?: string | null;
    lastSessionStatus?: string | null;
    lastSessionAt?: string | null;
    updatedAt: string;
}

export interface TestGroupRunPreviewMember {
    testCaseId: string;
    kind: 'LOGIN_FLOW' | 'TEST';
    position: number;
    displayId?: string | null;
    name: string;
    status: string | null;
    startedAt: string | null;
    lastRunId: string | null;
}

export interface TestGroupRunPreview {
    id: string;
    name: string;
    displayId?: string | null;
    members: TestGroupRunPreviewMember[];
    activeSessionId: string | null;
    activeSessionStatus: string | null;
}

export interface TestGroupLoginSessionInput {
    loginFlowId: string;
    name?: string;
}

export interface TestGroupUpsertInput {
    name: string;
    displayId?: string | null;
    onFailure?: TestGroupFailureMode;
    executionMode?: TestGroupExecutionMode;
    retryPolicy?: TestGroupRetryPolicy;
    loginSessions?: TestGroupLoginSessionInput[];
    testCaseIds: string[];
}

export interface TestGroupSessionSummary {
    id: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    memberCount: number;
    triggeredByEmail: string | null;
    triggerSource: string;
}
