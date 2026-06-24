import type { BrowserConfig, TargetConfig, TestCaseKind, TestStep } from '@/types';

export interface TestData {
    url: string;
    prompt: string;
    name?: string;
    displayId?: string;
    kind?: TestCaseKind;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
}
