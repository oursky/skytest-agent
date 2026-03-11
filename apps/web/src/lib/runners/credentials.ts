import { createHash, randomBytes } from 'crypto';

const PAIRING_TOKEN_PREFIX = 'st_pair_';
const RUNNER_TOKEN_PREFIX = 'st_runner_';
const TOKEN_RANDOM_BYTES = 32;

function createToken(prefix: string): { raw: string; prefix: string; hash: string } {
    const randomPart = randomBytes(TOKEN_RANDOM_BYTES).toString('base64url');
    const raw = `${prefix}${randomPart}`;
    return {
        raw,
        prefix: raw.slice(0, 16),
        hash: hashRunnerToken(raw),
    };
}

export function generatePairingToken(): { raw: string; prefix: string; hash: string } {
    return createToken(PAIRING_TOKEN_PREFIX);
}

export function generateRunnerToken(): { raw: string; prefix: string; hash: string } {
    return createToken(RUNNER_TOKEN_PREFIX);
}

export function hashRunnerToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
}

export function isPairingTokenFormat(token: string): boolean {
    return token.startsWith(PAIRING_TOKEN_PREFIX);
}

export function isRunnerTokenFormat(token: string): boolean {
    return token.startsWith(RUNNER_TOKEN_PREFIX);
}
