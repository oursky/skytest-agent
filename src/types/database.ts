export interface Project {
    id: string;
    name: string;
    teamId: string;
    createdByUserId: string;
    createdAt: string;
    updatedAt: string;
    _count?: {
        testCases: number;
    };
    hasActiveRuns?: boolean;
}

export type TeamRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface Team {
    id: string;
    name: string;
    role?: TeamRole;
    openRouterKeyUpdatedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface TeamMembership {
    id: string;
    teamId: string;
    userId: string | null;
    email: string | null;
    role: TeamRole;
    createdAt: string;
    updatedAt: string;
}

export interface UsageRecord {
    id: string;
    actorUserId: string;
    projectId: string;
    type: string;
    description: string | null;
    aiActions: number;
    testRunId: string | null;
    createdAt: string;
}

export interface TestCase {
    id: string;
    displayId?: string;
    status?: TestStatus;
    name: string;
    url: string;
    prompt: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig>;
    projectId: string;
    createdAt: string;
    updatedAt: string;
    testRuns?: TestRun[];
}

export interface TestRun {
    id: string;
    testCaseId: string;
    status: TestStatus;
    result?: string;
    error?: string;
    createdAt: string;
    events?: TestEvent[];
}

import type { TestStep, BrowserConfig, TestStatus } from './test';
import type { TestEvent } from './events';
