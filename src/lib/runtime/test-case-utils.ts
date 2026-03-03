import type { TestStep, BrowserConfig, TargetConfig } from '@/types';
import { normalizeBrowserConfig } from '@/lib/browser-target';

interface TestCaseWithJsonFields {
    steps?: string | null;
    browserConfig?: string | null;
}

type ParsedTestCase<T extends TestCaseWithJsonFields> = Omit<T, 'steps' | 'browserConfig'> & {
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
};

function safeParseJson<T>(value: string | null | undefined): T | undefined {
    if (!value) {
        return undefined;
    }

    try {
        return JSON.parse(value) as T;
    } catch {
        return undefined;
    }
}

export function cleanStepsForStorage(steps: TestStep[]): TestStep[] {
    return steps.map((step) => {
        const { aiAction, codeAction, ...cleanedStep } = step;
        void aiAction;
        void codeAction;
        return cleanedStep;
    });
}

export function normalizeTargetConfigMap(
    browserConfig: Record<string, BrowserConfig | TargetConfig>
): Record<string, BrowserConfig | TargetConfig> {
    return Object.fromEntries(
        Object.entries(browserConfig).map(([targetId, targetConfig]) => {
            if ('type' in targetConfig && targetConfig.type === 'android') {
                return [targetId, targetConfig];
            }
            return [targetId, normalizeBrowserConfig(targetConfig as BrowserConfig)];
        })
    );
}

export function parseTestCaseJson<T extends TestCaseWithJsonFields>(testCase: T): ParsedTestCase<T> {
    const { steps, browserConfig, ...rest } = testCase;
    const parsedBrowserConfig = safeParseJson<Record<string, BrowserConfig | TargetConfig>>(browserConfig);
    const normalizedBrowserConfig = parsedBrowserConfig
        ? Object.fromEntries(
            Object.entries(parsedBrowserConfig).map(([targetId, targetConfig]) => {
                if ('type' in targetConfig && targetConfig.type === 'android') {
                    return [targetId, targetConfig];
                }
                return [targetId, normalizeBrowserConfig(targetConfig as BrowserConfig)];
            })
        )
        : undefined;

    return {
        ...rest,
        steps: safeParseJson<TestStep[]>(steps),
        browserConfig: normalizedBrowserConfig,
    } as ParsedTestCase<T>;
}
