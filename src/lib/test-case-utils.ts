import type { TestStep, BrowserConfig, TargetConfig } from '@/types';

interface TestCaseWithJsonFields {
    steps?: string | null;
    browserConfig?: string | null;
}

type ParsedTestCase<T extends TestCaseWithJsonFields> = Omit<T, 'steps' | 'browserConfig'> & {
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
};

export function parseTestCaseJson<T extends TestCaseWithJsonFields>(testCase: T): ParsedTestCase<T> {
    const { steps, browserConfig, ...rest } = testCase;
    return {
        ...rest,
        steps: steps ? JSON.parse(steps) : undefined,
        browserConfig: browserConfig ? JSON.parse(browserConfig) : undefined,
    } as ParsedTestCase<T>;
}
