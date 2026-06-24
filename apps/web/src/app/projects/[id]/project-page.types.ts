export interface TestRun {
    id: string;
    status: string;
    createdAt: string;
}

export interface TestCase {
    id: string;
    displayId?: string;
    kind: 'TEST' | 'LOGIN_FLOW';
    status?: string;
    name: string;
    updatedAt: string;
    testRuns: TestRun[];
    usedByCount?: number;
}

export interface ProjectPageProps {
    params: Promise<{ id: string }>;
}

export interface Project {
    id: string;
    name: string;
    teamId: string;
    maxConcurrentRuns: number;
    maxConcurrentRunsLimit?: number;
    canManageProject?: boolean;
}

export type ProjectTab = 'test-cases' | 'login-flows' | 'test-groups' | 'variables' | 'integration' | 'scheduler' | 'settings';
export type SortColumn = 'id' | 'name' | 'status' | 'updated';
