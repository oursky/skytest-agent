export const MIN_AI_API_KEY_LENGTH = 8;

const VISIBLE_ASCII_KEY_PATTERN = /^[\x21-\x7E]+$/;

const AI_API_KEY_MESSAGES = {
    empty: 'API key is required',
    too_short: `API key must be at least ${MIN_AI_API_KEY_LENGTH} characters`,
    non_ascii: 'API key must use visible ASCII characters only (no spaces, newlines, or emojis)',
} as const;

export type AiApiKeyInvalidReason = keyof typeof AI_API_KEY_MESSAGES;

export type AiApiKeyValidationResult =
    | { ok: true }
    | { ok: false; reason: AiApiKeyInvalidReason; message: string };

export function validateAiApiKey(apiKey: string): AiApiKeyValidationResult {
    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
        return {
            ok: false,
            reason: 'empty',
            message: AI_API_KEY_MESSAGES.empty,
        };
    }

    if (trimmedApiKey.length < MIN_AI_API_KEY_LENGTH) {
        return {
            ok: false,
            reason: 'too_short',
            message: AI_API_KEY_MESSAGES.too_short,
        };
    }

    if (!VISIBLE_ASCII_KEY_PATTERN.test(trimmedApiKey)) {
        return {
            ok: false,
            reason: 'non_ascii',
            message: AI_API_KEY_MESSAGES.non_ascii,
        };
    }

    return { ok: true };
}
