import { describe, expect, it } from 'vitest';
import { findBlockedPlaywrightToken } from '@/lib/test-config/playwright-blocked-tokens';

describe('findBlockedPlaywrightToken', () => {
    it.each([
        `await page.getByText('Add document processing').click();`,
        'await expect(page.getByText("document")).toBeVisible();',
        'await page.getByText(`Convert document into Excel`).click();',
    ])('allows blocked-token text inside string literals: %s', (code) => {
        expect(findBlockedPlaywrightToken(code)).toBeNull();
    });

    it('still blocks executable access to a blocked identifier', () => {
        expect(findBlockedPlaywrightToken('document.querySelector("main")')).toBe('document');
    });

    it('still checks executable expressions inside template literals', () => {
        expect(findBlockedPlaywrightToken('await page.getByText(`${document.title}`)')).toBe('document');
    });
});
