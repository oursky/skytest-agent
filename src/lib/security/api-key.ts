import { randomBytes, createHash } from 'crypto';

const API_KEY_PREFIX = 'sk_test_';
const API_KEY_RANDOM_BYTES = 32;

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
    const randomPart = randomBytes(API_KEY_RANDOM_BYTES).toString('base64url');
    const raw = `${API_KEY_PREFIX}${randomPart}`;
    const prefix = raw.substring(0, 12);
    const hash = hashApiKey(raw);
    return { raw, prefix, hash };
}

export function hashApiKey(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
}

export function isApiKeyFormat(token: string): boolean {
    return token.startsWith(API_KEY_PREFIX);
}
