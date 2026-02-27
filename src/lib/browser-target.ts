import { config } from '@/config/app';
import type { BrowserConfig } from '@/types';

export function getDefaultBrowserViewport() {
    return {
        width: config.test.browser.viewport.width,
        height: config.test.browser.viewport.height,
    };
}

function normalizePositiveInt(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return fallback;
}

export function normalizeBrowserViewportDimensions(input: { width?: unknown; height?: unknown }): { width: number; height: number } {
    const defaults = getDefaultBrowserViewport();
    return {
        width: normalizePositiveInt(input.width, defaults.width),
        height: normalizePositiveInt(input.height, defaults.height),
    };
}

export function normalizeBrowserConfig(configValue: Partial<BrowserConfig>): BrowserConfig {
    const viewport = normalizeBrowserViewportDimensions({
        width: configValue.width,
        height: configValue.height,
    });
    return {
        name: configValue.name,
        url: configValue.url || '',
        width: viewport.width,
        height: viewport.height,
    };
}
