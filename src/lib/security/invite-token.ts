import { createHash, randomBytes } from 'crypto';

const INVITE_TOKEN_BYTES = 32;

export function generateInviteToken(): string {
    return randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

export function hashInviteToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
}
