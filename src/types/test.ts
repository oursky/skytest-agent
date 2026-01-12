export type TestStatus = 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL' | 'CANCELLED' | 'QUEUED';

export interface BrowserConfig {
    url: string;
    username?: string;
    password?: string;
}

export type StepType = 'ai-action' | 'playwright-code';

export interface TestStep {
    id: string;
    target: string;
    action: string;
    type?: StepType;
    aiAction?: string;
    codeAction?: string;
}

export interface TestData {
    url: string;
    username?: string;
    password?: string;
    prompt: string;
    name?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig>;
}

export interface RunTestOptions {
    runId: string;
    config: {
        url: string;
        username?: string;
        password?: string;
        prompt: string;
        steps?: TestStep[];
        browserConfig?: Record<string, BrowserConfig>;
        userId?: string;
        openRouterApiKey?: string;
    };
    onEvent: (event: TestEvent) => void;
    signal?: AbortSignal;
    onCleanup?: (cleanup: () => Promise<void>) => void;
}

export interface TestResult {
    status: 'PASS' | 'FAIL' | 'CANCELLED';
    error?: string;
    actionCount?: number;
}

import type { TestEvent } from './events';
