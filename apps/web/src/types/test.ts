import type { TestEvent } from './events';
import type { RunTerminalStatus } from './status';
import type { BuildMidsceneModelConfigOptions } from '@/lib/runtime/midscene-env';

export interface BrowserConfig {
    name?: string;
    url: string;
    width: number;
    height: number;
    loginFlowId?: string;        // TestCase id (kind=LOGIN_FLOW) to run as a login prefix
    reuseGroupSession?: boolean;  // continue a run group's live session instead of re-logging in
}

export const TEST_CASE_KIND = {
    TEST: 'TEST',
    LOGIN_FLOW: 'LOGIN_FLOW',
} as const;

export type TestCaseKind = typeof TEST_CASE_KIND[keyof typeof TEST_CASE_KIND];

export type TargetType = 'browser' | 'android';

export interface BrowserTargetConfig {
    type: 'browser';
    name?: string;
    url: string;
    width: number;
    height: number;
}

export interface AndroidEmulatorProfileSelector {
    mode: 'emulator-profile';
    emulatorProfileName: string;
}

export interface AndroidConnectedDeviceSelector {
    mode: 'connected-device';
    serial: string;
}

export type AndroidDeviceSelector = AndroidEmulatorProfileSelector | AndroidConnectedDeviceSelector;

export interface AndroidRunnerScope {
    runnerId: string;
}

export interface AndroidTargetConfig {
    type: 'android';
    name?: string;
    deviceSelector: AndroidDeviceSelector;
    runnerScope?: AndroidRunnerScope;
    appId: string;
    clearAppState: boolean;
    allowAllPermissions: boolean;
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
    kind?: TestCaseKind;
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
        teamId?: string;
        openRouterApiKey?: string;
        aiProvider?: string;
        midsceneModelOptions?: BuildMidsceneModelConfigOptions;
        testCaseId?: string;
        files?: TestCaseFile[];
        projectId?: string;
        resolvedVariables?: Record<string, string>;
        resolvedFiles?: Record<string, string>;
    };
    onEvent: (event: TestEvent) => void;
    signal?: AbortSignal;
    onCleanup?: (cleanup: () => Promise<void>) => void;
    onPreparing?: () => Promise<void>;
    onRunning?: () => Promise<void>;
    onStepHeartbeat?: () => Promise<void>;
}

export type TestFailureCategory =
    | 'INFRA_NETWORK'
    | 'TEST_ASSERTION'
    | 'TEST_SCRIPT'
    | 'CONFIGURATION'
    | 'TIMEOUT'
    | 'UNKNOWN';

export type TestFailureCode =
    | 'DNS_RESOLUTION_FAILED'
    | 'NETWORK_REQUEST_BLOCKED'
    | 'AI_ASSERTION_FAILED'
    | 'PLAYWRIGHT_ASSERTION_FAILED'
    | 'PLAYWRIGHT_CODE_FAILED'
    | 'AI_KEY_INVALID_FORMAT'
    | 'CONFIGURATION_ERROR'
    | 'TEST_TIMEOUT'
    | 'UNKNOWN_ERROR';

export interface TestResult {
    status: RunTerminalStatus;
    error?: string;
    errorCode?: TestFailureCode;
    errorCategory?: TestFailureCategory;
    actionCount?: number;
}

export type ConfigType = 'URL' | 'VARIABLE' | 'RANDOM_STRING' | 'FILE' | 'APP_ID';

export type RandomStringGenerationType = 'TIMESTAMP_UNIX' | 'TIMESTAMP_DATETIME' | 'UUID';

export interface ConfigItem {
    id: string;
    name: string;
    type: ConfigType;
    value: string;
    masked?: boolean;
    group?: string | null;
    filename?: string;
    mimeType?: string;
    size?: number;
}

export interface ResolvedConfig {
    name: string;
    type: ConfigType;
    value: string;
    masked?: boolean;
    group?: string | null;
    filename?: string;
    source: 'project' | 'test-case';
}
