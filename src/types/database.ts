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
    requestedDeviceId?: string | null;
    assignedRunnerId?: string | null;
    leaseExpiresAt?: string | null;
    lastEventAt?: string | null;
    nextEventSequence?: number;
    status: TestStatus;
    result?: string;
    error?: string;
    createdAt: string;
    events?: TestEvent[];
}

export interface Runner {
    id: string;
    teamId: string;
    label: string;
    kind: string;
    capabilities: string[];
    protocolVersion: string;
    runnerVersion: string;
    status: string;
    lastSeenAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface RunnerToken {
    id: string;
    teamId: string;
    runnerId: string | null;
    createdByUserId: string | null;
    kind: string;
    prefix: string;
    expiresAt: string;
    revokedAt: string | null;
    consumedAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
}

export interface RunnerDevice {
    id: string;
    runnerId: string;
    deviceId: string;
    platform: string;
    name: string;
    state: string;
    metadata: Record<string, unknown> | null;
    lastSeenAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface TestRunEventRow {
    id: string;
    runId: string;
    sequence: number;
    kind: string;
    message: string | null;
    payload: Record<string, unknown> | null;
    artifactKey: string | null;
    createdAt: string;
}

import type { TestStep, BrowserConfig, TestStatus } from './test';
import type { TestEvent } from './events';
