import { describe, expect, it } from 'vitest';
import { generateInviteToken, hashInviteToken } from '@/lib/security/invite-token';

describe('invite token helpers', () => {
    it('generates opaque tokens and stable hashes', () => {
        const token = generateInviteToken();

        expect(token.length).toBeGreaterThan(20);
        expect(hashInviteToken(token)).toBe(hashInviteToken(token));
        expect(hashInviteToken(token)).not.toBe(token);
    });
});
