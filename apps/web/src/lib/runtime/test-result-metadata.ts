import type { TestFailureCategory, TestFailureCode } from '@/types';

interface ParsedResultShape {
    errorCode?: unknown;
    errorCategory?: unknown;
}

const FAILURE_CODES: ReadonlySet<TestFailureCode> = new Set([
    'DNS_RESOLUTION_FAILED',
    'NETWORK_REQUEST_BLOCKED',
    'PLAYWRIGHT_ASSERTION_FAILED',
    'PLAYWRIGHT_CODE_FAILED',
    'CONFIGURATION_ERROR',
    'TEST_TIMEOUT',
    'UNKNOWN_ERROR',
]);

const FAILURE_CATEGORIES: ReadonlySet<TestFailureCategory> = new Set([
    'INFRA_NETWORK',
    'TEST_ASSERTION',
    'TEST_SCRIPT',
    'CONFIGURATION',
    'TIMEOUT',
    'UNKNOWN',
]);

export interface TestResultMetadata {
    errorCode?: TestFailureCode;
    errorCategory?: TestFailureCategory;
}

export function parseTestResultMetadata(rawResult: string | null | undefined): TestResultMetadata {
    if (!rawResult) {
        return {};
    }

    try {
        const parsed = JSON.parse(rawResult) as ParsedResultShape;
        const metadata: TestResultMetadata = {};

        if (typeof parsed.errorCode === 'string' && FAILURE_CODES.has(parsed.errorCode as TestFailureCode)) {
            metadata.errorCode = parsed.errorCode as TestFailureCode;
        }

        if (typeof parsed.errorCategory === 'string' && FAILURE_CATEGORIES.has(parsed.errorCategory as TestFailureCategory)) {
            metadata.errorCategory = parsed.errorCategory as TestFailureCategory;
        }

        return metadata;
    } catch {
        return {};
    }
}
