import type { BrowserConfig, TargetConfig, TestStep } from '@/types';

export interface TestData {
    url: string;
    prompt: string;
    name?: string;
    displayId?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
}
