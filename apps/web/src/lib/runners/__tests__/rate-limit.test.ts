import { describe, expect, it } from 'vitest';
import { getRateLimitKey } from '@/lib/runners/rate-limit';

describe('getRateLimitKey', () => {
    it('prefers fly-client-ip over spoofable forwarded headers', () => {
        const request = new Request('http://localhost/api/test', {
            headers: {
                'fly-client-ip': '198.51.100.10',
                'x-real-ip': '198.51.100.20',
                'x-forwarded-for': '203.0.113.1, 203.0.113.2',
            },
        });

        expect(getRateLimitKey(request, 'runner')).toBe('runner:198.51.100.10');
    });

    it('falls back to x-real-ip and then x-forwarded-for', () => {
        const withRealIp = new Request('http://localhost/api/test', {
            headers: {
                'x-real-ip': '198.51.100.20',
                'x-forwarded-for': '203.0.113.1, 203.0.113.2',
            },
        });
        expect(getRateLimitKey(withRealIp, 'runner')).toBe('runner:198.51.100.20');

        const withForwardedFor = new Request('http://localhost/api/test', {
            headers: {
                'x-forwarded-for': '203.0.113.1, 203.0.113.2',
            },
        });
        expect(getRateLimitKey(withForwardedFor, 'runner')).toBe('runner:203.0.113.1');
    });
});
