import { validateTargetUrl } from '@/lib/security/url-security';
import { substituteVariables } from '@/lib/test-config/substitution';
import type { BrowserConfig, TargetConfig } from '@/types';

interface UrlValidationConfig {
    url?: string;
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
}

const URL_TEMPLATE_REGEX = /\{\{[^}]+\}\}/;
const UNRESOLVED_VARIABLE_REGEX = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

function collectConfigUrls(config: UrlValidationConfig): string[] {
    const urls: string[] = [];
    if (config.url) {
        urls.push(config.url);
    }
    if (config.browserConfig) {
        for (const entry of Object.values(config.browserConfig)) {
            if ('type' in entry && entry.type === 'android') {
                continue;
            }
            if (entry.url) {
                urls.push(entry.url);
            }
        }
    }
    return urls;
}

function collectUnresolvedVariableNames(value: string): string[] {
    const matches = Array.from(value.matchAll(UNRESOLVED_VARIABLE_REGEX), (match) => match[1]);
    return Array.from(new Set(matches));
}

export function hasTemplatedConfigUrls(config: UrlValidationConfig): boolean {
    return collectConfigUrls(config).some((url) => URL_TEMPLATE_REGEX.test(url));
}

export function validateConfigUrls(
    config: UrlValidationConfig,
    variables: Record<string, string> = {}
): string | null {
    for (const rawUrl of collectConfigUrls(config)) {
        const resolvedUrl = substituteVariables(rawUrl, variables);
        const unresolvedVariables = collectUnresolvedVariableNames(resolvedUrl);
        if (unresolvedVariables.length > 0) {
            return `Missing configuration value(s) for URL variable(s): ${unresolvedVariables.join(', ')}`;
        }

        const result = validateTargetUrl(resolvedUrl);
        if (!result.valid) {
            return result.error || 'Target URL is not allowed';
        }
    }

    return null;
}
