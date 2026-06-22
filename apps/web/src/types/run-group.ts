export interface RunGroupItemSummary {
    testCaseId: string;
    position: number;
    displayId?: string | null;
    name: string;
    reuseGroupSession?: boolean;
}

export interface RunGroupSummary {
    id: string;
    name: string;
    displayId?: string | null;
    loginFlowId?: string | null;
    items: RunGroupItemSummary[];
    lastSessionId?: string | null;
    lastSessionStatus?: string | null;
    lastSessionAt?: string | null;
    updatedAt: string;
}

export interface RunGroupUpsertInput {
    name: string;
    displayId?: string | null;
    loginFlowId?: string | null;
    testCaseIds: string[];
}

export interface RunGroupSessionSummary {
    id: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    memberCount: number;
    triggeredByEmail: string | null;
    triggerSource: string;
}
