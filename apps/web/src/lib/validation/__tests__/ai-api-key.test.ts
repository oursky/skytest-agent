import { describe, expect, it } from 'vitest';
import { MIN_AI_API_KEY_LENGTH, validateAiApiKey } from '@/lib/validation/ai-api-key';

describe('validateAiApiKey', () => {
    it('rejects empty values', () => {
        expect(validateAiApiKey('   ')).toEqual({
            ok: false,
            reason: 'empty',
            message: 'API key is required',
        });
    });

    it('rejects too-short values', () => {
        expect(validateAiApiKey('abc1234')).toEqual({
            ok: false,
            reason: 'too_short',
            message: `API key must be at least ${MIN_AI_API_KEY_LENGTH} characters`,
        });
    });

    it('rejects non-ascii values', () => {
        expect(validateAiApiKey('abc12345✅')).toEqual({
            ok: false,
            reason: 'non_ascii',
            message: 'API key must use visible ASCII characters only (no spaces, newlines, or emojis)',
        });
    });

    it('accepts visible-ascii values that meet minimum length', () => {
        expect(validateAiApiKey('sk-abc12345')).toEqual({ ok: true });
    });
});
