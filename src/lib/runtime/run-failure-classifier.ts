import { ConfigurationError, PlaywrightCodeError, getErrorMessage } from '@/lib/core/errors';
import type { BrowserNetworkGuardSummary } from '@/lib/runtime/browser-network-guard';
import type { TestFailureCategory, TestFailureCode } from '@/types';

export interface RunFailureClassification {
    code: TestFailureCode;
    category: TestFailureCategory;
}

const PLAYWRIGHT_ASSERTION_PATTERNS = [
    /expect\s*\(/i,
    /tobevisible/i,
    /tohave/i,
    /locator:/i,
    /verification failed/i,
];

const DNS_FAILURE_PATTERNS = [
    /dns lookup failed/i,
    /dns lookup timed out/i,
    /dns resolution failed/i,
    /err_name_not_resolved/i,
    /\bdns_resolution_failed\b/i,
];

function hasDnsLookupFailure(summaries: BrowserNetworkGuardSummary[]): boolean {
    return summaries.some((summary) => summary.dnsLookupFailureCount > 0);
}

function hasNetworkBlocks(summaries: BrowserNetworkGuardSummary[]): boolean {
    return summaries.some((summary) => summary.blockedRequestCount > 0);
}

function isPlaywrightAssertionFailure(error: unknown, message: string): boolean {
    if (error instanceof PlaywrightCodeError && error.originalError) {
        const originalMessage = getErrorMessage(error.originalError);
        if (PLAYWRIGHT_ASSERTION_PATTERNS.some((pattern) => pattern.test(originalMessage))) {
            return true;
        }
    }

    return PLAYWRIGHT_ASSERTION_PATTERNS.some((pattern) => pattern.test(message));
}

export function classifyRunFailure(
    error: unknown,
    options?: {
        timedOut?: boolean;
        networkGuardSummaries?: BrowserNetworkGuardSummary[];
    }
): RunFailureClassification {
    if (options?.timedOut) {
        return { code: 'TEST_TIMEOUT', category: 'TIMEOUT' };
    }

    const message = getErrorMessage(error);
    const summaries = options?.networkGuardSummaries ?? [];

    if (DNS_FAILURE_PATTERNS.some((pattern) => pattern.test(message)) || hasDnsLookupFailure(summaries)) {
        return { code: 'DNS_RESOLUTION_FAILED', category: 'INFRA_NETWORK' };
    }

    if (hasNetworkBlocks(summaries)) {
        return { code: 'NETWORK_REQUEST_BLOCKED', category: 'INFRA_NETWORK' };
    }

    if (isPlaywrightAssertionFailure(error, message)) {
        return { code: 'PLAYWRIGHT_ASSERTION_FAILED', category: 'TEST_ASSERTION' };
    }

    if (error instanceof PlaywrightCodeError) {
        return { code: 'PLAYWRIGHT_CODE_FAILED', category: 'TEST_SCRIPT' };
    }

    if (error instanceof ConfigurationError) {
        return { code: 'CONFIGURATION_ERROR', category: 'CONFIGURATION' };
    }

    return { code: 'UNKNOWN_ERROR', category: 'UNKNOWN' };
}
