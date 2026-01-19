export interface Project {
    id: string;
    name: string;
    userId: string;
    createdAt: string;
    updatedAt: string;
    _count?: {
        testCases: number;
    };
    hasActiveRuns?: boolean;
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
    username?: string;
    password?: string;
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
