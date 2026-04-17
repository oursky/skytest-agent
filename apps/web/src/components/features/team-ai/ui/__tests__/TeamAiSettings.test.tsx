import { describe, expect, it } from 'vitest';
import {
    getTeamAiApiKeyReasonMessageKey,
    shouldShowTeamAiApiKeyInput,
    validateProvidedTeamAiApiKeyInput,
} from '@/components/features/team-ai/ui/TeamAiSettings';

describe('TeamAiSettings local API key validation', () => {
    it('rejects emoji key locally and blocks submit', () => {
        const result = validateProvidedTeamAiApiKeyInput('sk-abc✅12345');

        expect(result).toEqual({
            trimmedApiKey: 'sk-abc✅12345',
            reason: 'non_ascii',
            canSubmitForm: false,
        });
        expect(getTeamAiApiKeyReasonMessageKey(result.reason!)).toBe('team.ai.apiKey.invalid.nonAscii');
    });

    it('rejects key with whitespace/newline locally and blocks submit', () => {
        const result = validateProvidedTeamAiApiKeyInput('sk-abc1234\nvalue');

        expect(result).toEqual({
            trimmedApiKey: 'sk-abc1234\nvalue',
            reason: 'non_ascii',
            canSubmitForm: false,
        });
    });

    it('rejects too-short key locally and blocks submit', () => {
        const result = validateProvidedTeamAiApiKeyInput('short7');

        expect(result).toEqual({
            trimmedApiKey: 'short7',
            reason: 'too_short',
            canSubmitForm: false,
        });
    });

    it('accepts valid key and allows submit', () => {
        const result = validateProvidedTeamAiApiKeyInput('sk-abc12345');

        expect(result).toEqual({
            trimmedApiKey: 'sk-abc12345',
            reason: null,
            canSubmitForm: true,
        });
    });

    it('shows API key input when stored key is invalid', () => {
        expect(shouldShowTeamAiApiKeyInput({ hasKey: true, keyInvalid: true })).toBe(true);
    });

    it('shows masked key when stored key exists and is valid', () => {
        expect(shouldShowTeamAiApiKeyInput({ hasKey: true, keyInvalid: false })).toBe(false);
    });
});
