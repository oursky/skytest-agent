export type TestStatus = 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL' | 'CANCELLED' | 'QUEUED' | 'DRAFT' | 'PREPARING';

export interface BrowserConfig {
    name?: string;
    url: string;
}

export type TargetType = 'browser' | 'android';

export interface BrowserTargetConfig {
    type: 'browser';
    name?: string;
    url: string;
}

export interface AndroidTargetConfig {
    type: 'android';
    name?: string;
    avdName: string;
    apkId: string;
    activity?: string;
}

export type TargetConfig = BrowserTargetConfig | AndroidTargetConfig;

export type StepType = 'ai-action' | 'playwright-code';

export interface TestCaseFile {
    id: string;
    filename: string;
    storedName: string;
    mimeType: string;
    size: number;
    createdAt?: string;
}

export interface TestStep {
    id: string;
    target: string;
    action: string;
    type?: StepType;
    aiAction?: string;
    codeAction?: string;
    files?: string[];
}

export interface TestData {
    url?: string;
    prompt?: string;
    name?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    files?: TestCaseFile[];
}

export interface RunTestOptions {
    runId: string;
    config: {
        url?: string;
        prompt?: string;
        steps?: TestStep[];
        browserConfig?: Record<string, BrowserConfig | TargetConfig>;
        userId?: string;
        openRouterApiKey?: string;
        testCaseId?: string;
        files?: TestCaseFile[];
        projectId?: string;
        resolvedVariables?: Record<string, string>;
        resolvedFiles?: Record<string, string>;
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

export type ConfigType = 'URL' | 'VARIABLE' | 'SECRET' | 'RANDOM_STRING' | 'FILE';

export type RandomStringGenerationType = 'TIMESTAMP_UNIX' | 'TIMESTAMP_DATETIME' | 'UUID';

export interface ConfigItem {
    id: string;
    name: string;
    type: ConfigType;
    value: string;
    filename?: string;
    mimeType?: string;
    size?: number;
}

export interface ResolvedConfig {
    name: string;
    type: ConfigType;
    value: string;
    filename?: string;
    source: 'project' | 'test-case';
}

import type { TestEvent } from './events';
