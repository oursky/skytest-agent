import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    lookup: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
    lookup: mocks.lookup,
}));

const { validateRuntimeRequestUrl } = await import('@/lib/security/url-security-runtime');
const { config } = await import('@/config/app');
const securityConfig = config.test.security as { dnsLookupFailOpen: boolean };
const defaultDnsLookupFailOpen = securityConfig.dnsLookupFailOpen;

describe('validateRuntimeRequestUrl', () => {
    beforeEach(() => {
        mocks.lookup.mockReset();
    });

    afterEach(() => {
        securityConfig.dnsLookupFailOpen = defaultDnsLookupFailOpen;
    });

    it('allows request when DNS lookup fails in fail-open mode', async () => {
        mocks.lookup.mockRejectedValueOnce(new Error('lookup failed'));

        const result = await validateRuntimeRequestUrl('https://example.com/path');

        expect(result).toEqual({ valid: true });
    });

    it('reuses cached valid DNS result for repeated host validation', async () => {
        mocks.lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);

        const first = await validateRuntimeRequestUrl('https://example.org/a');
        const second = await validateRuntimeRequestUrl('https://example.org/b');

        expect(first).toEqual({ valid: true });
        expect(second).toEqual({ valid: true });
        expect(mocks.lookup).toHaveBeenCalledTimes(1);
    });

    it('blocks request when DNS lookup fails in strict mode', async () => {
        securityConfig.dnsLookupFailOpen = false;
        mocks.lookup.mockRejectedValueOnce(new Error('lookup failed'));

        const result = await validateRuntimeRequestUrl('https://example.net/path');

        expect(result).toEqual({ valid: false, error: 'DNS lookup failed' });
    });
});
