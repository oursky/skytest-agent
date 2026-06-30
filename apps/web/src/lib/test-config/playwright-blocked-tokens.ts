export const PLAYWRIGHT_CODE_BLOCKED_TOKENS = [
    'require',
    'import',
    'export',
    'process',
    'global',
    'globalThis',
    'window',
    'document',
    'Function',
    'eval',
    'child_process',
    'fs',
    'net',
    'http',
    'https',
    'dgram',
    'tls',
    'fetch',
    'XMLHttpRequest',
    'Buffer',
] as const;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findBlockedPlaywrightToken(code: string): string | null {
    for (const token of PLAYWRIGHT_CODE_BLOCKED_TOKENS) {
        const regex = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
        if (regex.test(code)) {
            return token;
        }
    }
    return null;
}
