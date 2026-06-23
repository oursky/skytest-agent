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
    loginFlowId?: string | null;
    items: TestGroupItemSummary[];
    lastSessionId?: string | null;
    lastSessionStatus?: string | null;
    lastSessionAt?: string | null;
    updatedAt: string;
}

export interface TestGroupUpsertInput {
    name: string;
    displayId?: string | null;
    loginFlowId?: string | null;
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
