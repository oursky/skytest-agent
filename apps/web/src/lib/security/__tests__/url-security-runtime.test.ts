import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    lookup: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
    lookup: mocks.lookup,
}));

const { validateRuntimeRequestUrl } = await import('@/lib/security/url-security-runtime');
const { config } = await import('@/config/app');
const securityConfig = config.test.security as {
    dnsLookupRetryAttempts: number;
    dnsLookupRetryDelayMs: number;
};
const defaultDnsLookupRetryAttempts = securityConfig.dnsLookupRetryAttempts;
const defaultDnsLookupRetryDelayMs = securityConfig.dnsLookupRetryDelayMs;

describe('validateRuntimeRequestUrl', () => {
    beforeEach(() => {
        mocks.lookup.mockReset();
        securityConfig.dnsLookupRetryAttempts = 3;
        securityConfig.dnsLookupRetryDelayMs = 0;
    });

    afterEach(() => {
        securityConfig.dnsLookupRetryAttempts = defaultDnsLookupRetryAttempts;
        securityConfig.dnsLookupRetryDelayMs = defaultDnsLookupRetryDelayMs;
    });

    it('returns DNS resolution failure code when all lookup attempts fail', async () => {
        mocks.lookup.mockRejectedValue(new Error('lookup failed'));

        const result = await validateRuntimeRequestUrl('https://failure.example.com/path');

        expect(result).toEqual({ valid: false, error: 'DNS lookup failed', code: 'DNS_RESOLUTION_FAILED' });
        expect(mocks.lookup).toHaveBeenCalledTimes(3);
    });

    it('retries lookup failures and succeeds when a later attempt resolves', async () => {
        mocks.lookup
            .mockRejectedValueOnce(new Error('lookup failed'))
            .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);

        const result = await validateRuntimeRequestUrl('https://retry.example.com/path');

        expect(result).toEqual({ valid: true });
        expect(mocks.lookup).toHaveBeenCalledTimes(2);
    });

    it('reuses cached valid DNS result for repeated host validation', async () => {
        mocks.lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);

        const first = await validateRuntimeRequestUrl('https://example.org/a');
        const second = await validateRuntimeRequestUrl('https://example.org/b');

        expect(first).toEqual({ valid: true });
        expect(second).toEqual({ valid: true });
        expect(mocks.lookup).toHaveBeenCalledTimes(1);
    });

    it('allows hosts to rotate across public addresses after pinning', async () => {
        vi.useFakeTimers();
        try {
            mocks.lookup
                .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
                .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }])
                .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);

            const first = await validateRuntimeRequestUrl('https://rebind.example.com/a');
            vi.advanceTimersByTime(6000);
            const second = await validateRuntimeRequestUrl('https://rebind.example.com/b');
            vi.advanceTimersByTime(6000);
            const third = await validateRuntimeRequestUrl('https://rebind.example.com/c');

            expect(first).toEqual({ valid: true });
            expect(second).toEqual({ valid: true });
            expect(third).toEqual({ valid: true });
            expect(mocks.lookup).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });
});
