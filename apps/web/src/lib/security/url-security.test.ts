import { afterEach, describe, expect, it, vi } from 'vitest';

describe('validateTargetUrl', () => {
    afterEach(() => {
        delete process.env.ALLOW_LOCALHOST_TEST_TARGETS;
        vi.resetModules();
    });

    it('blocks localhost by default', async () => {
        const { validateTargetUrl } = await import('./url-security');
        const result = validateTargetUrl('http://localhost:5173/mock-exam/dashboard');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Target host is not allowed');
    });

    it('allows localhost when ALLOW_LOCALHOST_TEST_TARGETS=true', async () => {
        process.env.ALLOW_LOCALHOST_TEST_TARGETS = 'true';
        vi.resetModules();

        const { validateTargetUrl } = await import('./url-security');
        const localhostResult = validateTargetUrl('http://localhost:5173/mock-exam/dashboard');
        const loopbackResult = validateTargetUrl('http://127.0.0.1:5173/mock-exam/dashboard');

        expect(localhostResult.valid).toBe(true);
        expect(loopbackResult.valid).toBe(true);
    });
});
