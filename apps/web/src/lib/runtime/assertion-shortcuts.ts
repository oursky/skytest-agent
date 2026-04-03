export function extractQuotedStrings(instruction: string): string[] {
    const matches: string[] = [];
    const regex = /["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(instruction)) !== null) {
        matches.push(match[1]);
    }
    return matches;
}

export function shouldUseQuotedStringShortcut(instruction: string, quotedStrings: string[]): boolean {
    if (quotedStrings.length === 0) {
        return false;
    }

    const normalized = instruction.trim().replace(/\s+/g, ' ');

    const simplePresencePatterns = [
        /^(verify|assert|check|confirm|ensure|validate)\s+(that\s+)?["'][^"']+["']\s+(is\s+)?(visible|shown|displayed|present|on the page|exists?)\.?$/i,
        /^(verify|assert|check|confirm|ensure|validate)\s+(that\s+)?text\s+["'][^"']+["']\s+(is\s+)?(visible|shown|displayed|present|on the page|exists?)\.?$/i,
        /^(verify|assert|check|confirm|ensure|validate)\s+(that\s+)?["'][^"']+["']\s*(appears?)\.?$/i,
    ];

    return simplePresencePatterns.some((pattern) => pattern.test(normalized));
}

export function formatAssertionFailureMessage(stepAction: string, reason: string): string {
    return `Verification failed.\nStep: ${stepAction}\nReason: ${reason}`;
}
