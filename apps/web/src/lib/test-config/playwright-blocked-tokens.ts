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

function stripStringsAndComments(code: string): string {
    let result = '';
    let index = 0;
    let quote: "'" | '"' | null = null;
    const templateExpressionDepth: number[] = [];
    let inTemplateText = false;

    while (index < code.length) {
        const char = code[index];
        const next = code[index + 1];

        if (quote) {
            if (char === '\\') {
                index += 2;
            } else {
                if (char === quote) quote = null;
                index += 1;
            }
            result += ' ';
            continue;
        }

        if (inTemplateText) {
            if (char === '\\') {
                index += 2;
            } else if (char === '`') {
                inTemplateText = false;
                index += 1;
            } else if (char === '$' && next === '{') {
                templateExpressionDepth.push(1);
                inTemplateText = false;
                index += 2;
            } else {
                index += 1;
            }
            result += ' ';
            continue;
        }

        if (char === '/' && next === '/') {
            const newline = code.indexOf('\n', index + 2);
            index = newline === -1 ? code.length : newline;
            result += ' ';
            continue;
        }

        if (char === '/' && next === '*') {
            const end = code.indexOf('*/', index + 2);
            index = end === -1 ? code.length : end + 2;
            result += ' ';
            continue;
        }

        if (char === "'" || char === '"') {
            quote = char;
            index += 1;
            result += ' ';
            continue;
        }

        if (char === '`') {
            inTemplateText = true;
            index += 1;
            result += ' ';
            continue;
        }

        if (templateExpressionDepth.length > 0) {
            const last = templateExpressionDepth.length - 1;
            if (char === '{') templateExpressionDepth[last] += 1;
            if (char === '}') {
                templateExpressionDepth[last] -= 1;
                if (templateExpressionDepth[last] === 0) {
                    templateExpressionDepth.pop();
                    inTemplateText = true;
                }
            }
        }

        result += char;
        index += 1;
    }

    return result;
}

export function findBlockedPlaywrightToken(code: string): string | null {
    const executableCode = stripStringsAndComments(code);
    for (const token of PLAYWRIGHT_CODE_BLOCKED_TOKENS) {
        const regex = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
        if (regex.test(executableCode)) {
            return token;
        }
    }
    return null;
}
