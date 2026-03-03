import type { ConfigItem, TestEvent } from '@/types';

export function buildEventKey(event: TestEvent): string {
    const browserId = event.browserId || '';
    return `${event.type}|${event.timestamp}|${browserId}|${JSON.stringify(event.data)}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
}

export function extractFileName(headerValue: string | null, fallbackName: string): string {
    if (!headerValue) return fallbackName;
    const utf8Match = headerValue.match(/filename\\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
        return decodeURIComponent(utf8Match[1]);
    }
    const quotedMatch = headerValue.match(/filename=\"([^\"]+)\"/i);
    if (quotedMatch?.[1]) {
        return quotedMatch[1];
    }
    const plainMatch = headerValue.match(/filename=([^;]+)/i);
    if (plainMatch?.[1]) {
        return plainMatch[1].trim();
    }
    return fallbackName;
}

export function buildExcelBaseName(testCaseIdentifier?: string, testCaseName?: string): string {
    const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_');
    const safeId = sanitize((testCaseIdentifier || '').trim());
    const safeName = sanitize((testCaseName || '').trim());
    if (safeId && safeName) return `${safeId}_${safeName}`;
    if (safeName) return safeName;
    if (safeId) return safeId;
    return 'test_case';
}

export function isExcelFilename(filename: string): boolean {
    const normalized = filename.toLowerCase();
    return normalized.endsWith('.xlsx');
}

export function isSupportedVariableConfig(
    config: ConfigItem
): config is ConfigItem & { type: 'URL' | 'APP_ID' | 'VARIABLE' | 'RANDOM_STRING' | 'FILE' } {
    return config.type === 'URL' || config.type === 'APP_ID' || config.type === 'VARIABLE' || config.type === 'RANDOM_STRING' || config.type === 'FILE';
}
