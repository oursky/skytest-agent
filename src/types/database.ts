export interface Project {
    id: string;
    name: string;
    organizationId: string;
    createdByUserId: string;
    createdAt: string;
    updatedAt: string;
    _count?: {
        testCases: number;
    };
    hasActiveRuns?: boolean;
}

export type OrganizationRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export type OrganizationInviteStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELED' | 'EXPIRED';

export interface Organization {
    id: string;
    name: string;
    role?: OrganizationRole;
    openRouterKeyUpdatedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface OrganizationMembership {
    id: string;
    organizationId: string;
    userId: string;
    role: OrganizationRole;
    createdAt: string;
    updatedAt: string;
}

export interface OrganizationInvite {
    id: string;
    organizationId: string;
    email: string;
    role: OrganizationRole;
    status: OrganizationInviteStatus;
    expiresAt: string;
    invitedByUserId: string;
    acceptedAt: string | null;
    declinedAt: string | null;
    canceledAt: string | null;
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
