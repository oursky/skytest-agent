export type TestStatus = 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL' | 'CANCELLED' | 'QUEUED';

export interface BrowserConfig {
    url: string;
    username?: string;
    password?: string;
}

export interface TestStep {
    id: string;
    target: string;
    action: string;
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
    };
    onEvent: (event: TestEvent) => void;
    signal?: AbortSignal;
}

export interface TestResult {
    status: 'PASS' | 'FAIL' | 'CANCELLED';
    error?: string;
}

import type { TestEvent } from './events';
