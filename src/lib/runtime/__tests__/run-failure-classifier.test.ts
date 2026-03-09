import { describe, expect, it } from 'vitest';
import { ConfigurationError, PlaywrightCodeError } from '@/lib/core/errors';
import { classifyRunFailure } from '@/lib/runtime/run-failure-classifier';
import type { BrowserNetworkGuardSummary } from '@/lib/runtime/browser-network-guard';

function createSummary(overrides?: Partial<BrowserNetworkGuardSummary>): BrowserNetworkGuardSummary {
    return {
        targetId: 'browser_a',
        blockedRequestCount: 0,
        dnsLookupFailureCount: 0,
        blockedByCode: {},
        blockedByReason: {},
        blockedByHostname: {},
        ...overrides,
    };
}

describe('classifyRunFailure', () => {
    it('classifies DNS failures from message content', () => {
        const result = classifyRunFailure(new Error('DNS lookup failed while loading page'));
        expect(result).toEqual({
            code: 'DNS_RESOLUTION_FAILED',
            category: 'INFRA_NETWORK',
        });
    });

    it('classifies DNS failures from network guard summaries', () => {
        const result = classifyRunFailure(new Error('element not found'), {
            networkGuardSummaries: [createSummary({ dnsLookupFailureCount: 2, blockedRequestCount: 2 })],
        });

        expect(result).toEqual({
            code: 'DNS_RESOLUTION_FAILED',
            category: 'INFRA_NETWORK',
        });
    });

    it('classifies Playwright assertion errors distinctly', () => {
        const originalError = new Error('expect(locator).toBeVisible() failed');
        const error = new PlaywrightCodeError('Playwright code execution failed', 0, 'await expect(...);', originalError);
        const result = classifyRunFailure(error);

        expect(result).toEqual({
            code: 'PLAYWRIGHT_ASSERTION_FAILED',
            category: 'TEST_ASSERTION',
        });
    });

    it('classifies non-assertion Playwright code errors as script failures', () => {
        const error = new PlaywrightCodeError('Playwright code execution failed: TypeError', 0, 'await page.foo();');
        const result = classifyRunFailure(error);

        expect(result).toEqual({
            code: 'PLAYWRIGHT_CODE_FAILED',
            category: 'TEST_SCRIPT',
        });
    });

    it('classifies configuration errors', () => {
        const result = classifyRunFailure(new ConfigurationError('Invalid URL', 'url'));
        expect(result).toEqual({
            code: 'CONFIGURATION_ERROR',
            category: 'CONFIGURATION',
        });
    });

    it('classifies timeout failures from explicit timeout signal', () => {
        const result = classifyRunFailure(new Error('ignored'), { timedOut: true });
        expect(result).toEqual({
            code: 'TEST_TIMEOUT',
            category: 'TIMEOUT',
        });
    });
});
