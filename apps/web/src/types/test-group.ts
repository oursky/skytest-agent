export const TEST_GROUP_FAILURE_MODE = {
    STOP: 'STOP',
    CONTINUE: 'CONTINUE',
} as const;

export type TestGroupFailureMode = typeof TEST_GROUP_FAILURE_MODE[keyof typeof TEST_GROUP_FAILURE_MODE];

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
    loginSessions: TestGroupLoginSessionSummary[];
    items: TestGroupItemSummary[];
    lastSessionId?: string | null;
    lastSessionStatus?: string | null;
    lastSessionAt?: string | null;
    updatedAt: string;
}

export interface TestGroupLoginSessionInput {
    loginFlowId: string;
    name?: string;
}

export interface TestGroupUpsertInput {
    name: string;
    displayId?: string | null;
    onFailure?: TestGroupFailureMode;
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
