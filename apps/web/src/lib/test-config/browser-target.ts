import { config } from '@/config/app';
import type { BrowserConfig, TargetConfig, TestCaseTargetSummary } from '@/types';

/** Parses a stored browserConfig JSON string into lightweight per-target summaries
 * (target label, kind, linked login flow, and reuse flag) for the Test Group UI. */
export function parseTestCaseTargets(browserConfig: string | null | undefined): TestCaseTargetSummary[] {
    if (!browserConfig) {
        return [];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(browserConfig);
    } catch {
        return [];
    }
    if (!parsed || typeof parsed !== 'object') {
        return [];
    }
    return Object.entries(parsed as Record<string, BrowserConfig | TargetConfig>).map(([key, cfg]) => {
        const name = typeof (cfg as { name?: unknown })?.name === 'string' ? (cfg as { name: string }).name.trim() : '';
        if (cfg && 'type' in cfg && (cfg as TargetConfig).type === 'android') {
            return { key, label: name || key, kind: 'android' as const, loginFlowId: null, reuseEnabled: false };
        }
        const browser = cfg as BrowserConfig;
        const loginFlowId = typeof browser.loginFlowId === 'string' && browser.loginFlowId.trim() ? browser.loginFlowId.trim() : null;
        return { key, label: name || key, kind: 'browser' as const, loginFlowId, reuseEnabled: browser.reuseGroupSession ?? false };
    });
}

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
    const loginFlowId = typeof configValue.loginFlowId === 'string' ? configValue.loginFlowId.trim() : '';
    return {
        name: configValue.name,
        url: configValue.url || '',
        width: viewport.width,
        height: viewport.height,
        ...(loginFlowId ? { loginFlowId } : {}),
        ...(typeof configValue.reuseGroupSession === 'boolean' ? { reuseGroupSession: configValue.reuseGroupSession } : {}),
        ...(typeof configValue.webauthnVirtualAuthenticator === 'boolean' ? { webauthnVirtualAuthenticator: configValue.webauthnVirtualAuthenticator } : {}),
    };
}
