import type { BrowserConfig, TargetConfig, TestStep } from '@/types';
import { normalizeBrowserConfig } from '@/lib/test-config/browser-target';
import type { BrowserEntry } from '@/components/features/test-configurations/model/types';
import type { TestData } from './types';

export function createStepId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildBrowsers(data?: TestData): BrowserEntry[] {
    if (data?.browserConfig && Object.keys(data.browserConfig).length > 0) {
        return Object.entries(data.browserConfig).map(([id, cfg]) => {
            if ('type' in cfg && cfg.type === 'android') {
                return { id, config: cfg };
            }
            const browserCfg = cfg as BrowserConfig;
            return { id, config: normalizeBrowserConfig(browserCfg) };
        });
    }

    return [{
        id: 'browser_a',
        config: normalizeBrowserConfig({
            url: data?.url || '',
        })
    }];
}

export function hasMissingRequiredTestingTargetFields(browsers: BrowserEntry[]): boolean {
    return browsers.some(({ config }) => {
        if ('type' in config && config.type === 'android') {
            return !config.appId?.trim();
        }

        return !config.url?.trim();
    });
}

export function buildSteps(data: TestData | undefined, browserId: string, validBrowserIds: Set<string>): TestStep[] {
    if (data?.steps && data.steps.length > 0) {
        return data.steps.map((step) => ({
            ...step,
            target: validBrowserIds.has(step.target) ? step.target : browserId,
            type: step.type || 'ai-action'
        }));
    }

    if (!data?.prompt) {
        return [];
    }

    return data.prompt
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((action, index) => ({
            id: createStepId(`prompt-${index}`),
            target: browserId,
            action,
            type: 'ai-action' as const
        }));
}

export function buildCurrentData(
    browsers: BrowserEntry[],
    steps: TestStep[],
    showNameInput: boolean | undefined,
    name: string,
    displayId: string | undefined
): TestData {
    const browserConfigMap: Record<string, BrowserConfig | TargetConfig> = {};
    browsers.forEach((browser) => {
        browserConfigMap[browser.id] = browser.config;
    });

    const firstConfig = browsers[0]?.config;
    const firstUrl = firstConfig && !('type' in firstConfig && firstConfig.type === 'android')
        ? (firstConfig as BrowserConfig).url || ''
        : '';

    return {
        name: showNameInput ? name : undefined,
        displayId: displayId || undefined,
        url: firstUrl,
        prompt: '',
        steps,
        browserConfig: browserConfigMap
    };
}
