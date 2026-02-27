import type { TestStep, BrowserConfig, TargetConfig } from './test';

export interface ApiKeyInfo {
    id: string;
    name: string;
    prefix: string;
    lastUsedAt: string | null;
    createdAt: string;
}

export interface GeneratedApiKey extends ApiKeyInfo {
    key: string;
}

export interface BatchTestCaseInput {
    name: string;
    displayId?: string;
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    configs?: Array<{
        name: string;
        type: string;
        value: string;
        masked?: boolean;
        group?: string | null;
    }>;
}

export interface BatchCreateRequest {
    testCases: BatchTestCaseInput[];
    source?: string;
}

export interface BatchCreateResult {
    created: Array<{ id: string; name: string; index: number }>;
    warnings: Array<{ index: number; message: string }>;
    totalCreated: number;
}
