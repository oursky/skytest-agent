import { describe, expect, it } from 'vitest';
import { parseTestResultMetadata } from '@/lib/runtime/test-result-metadata';

describe('parseTestResultMetadata', () => {
    it('extracts error metadata from serialized run result', () => {
        const result = parseTestResultMetadata(JSON.stringify({
            status: 'FAIL',
            error: 'DNS lookup failed',
            errorCode: 'DNS_RESOLUTION_FAILED',
            errorCategory: 'INFRA_NETWORK',
        }));

        expect(result).toEqual({
            errorCode: 'DNS_RESOLUTION_FAILED',
            errorCategory: 'INFRA_NETWORK',
        });
    });

    it('returns empty metadata when codes are not recognized', () => {
        const result = parseTestResultMetadata(JSON.stringify({
            errorCode: 'NOT_A_REAL_CODE',
            errorCategory: 'NOT_A_REAL_CATEGORY',
        }));

        expect(result).toEqual({});
    });

    it('extracts AI assertion failure metadata', () => {
        const result = parseTestResultMetadata(JSON.stringify({
            status: 'FAIL',
            error: 'Verification failed.',
            errorCode: 'AI_ASSERTION_FAILED',
            errorCategory: 'TEST_ASSERTION',
        }));

        expect(result).toEqual({
            errorCode: 'AI_ASSERTION_FAILED',
            errorCategory: 'TEST_ASSERTION',
        });
    });

    it('extracts AI key invalid format metadata', () => {
        const result = parseTestResultMetadata(JSON.stringify({
            status: 'FAIL',
            error: 'API key must use visible ASCII characters only',
            errorCode: 'AI_KEY_INVALID_FORMAT',
            errorCategory: 'CONFIGURATION',
        }));

        expect(result).toEqual({
            errorCode: 'AI_KEY_INVALID_FORMAT',
            errorCategory: 'CONFIGURATION',
        });
    });

    it('returns empty metadata for malformed result payload', () => {
        expect(parseTestResultMetadata('not-json')).toEqual({});
        expect(parseTestResultMetadata(undefined)).toEqual({});
    });
});
