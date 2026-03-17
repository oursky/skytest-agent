import { describe, expect, it } from 'vitest';

import { isBlockedIpAddress, validateTargetUrl } from '@/lib/security/url-security';

describe('url-security', () => {
    it('blocks IPv4-mapped IPv6 loopback addresses', () => {
        expect(isBlockedIpAddress('::ffff:127.0.0.1')).toBe(true);
        expect(validateTargetUrl('http://[::ffff:127.0.0.1]')).toEqual({
            valid: false,
            error: 'Private network addresses are not allowed',
        });
    });

    it('blocks bracketed IPv6 loopback addresses', () => {
        expect(validateTargetUrl('http://[::1]')).toEqual({
            valid: false,
            error: 'Private network addresses are not allowed',
        });
    });
});
