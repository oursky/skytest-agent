export function formatBrowserLabel(index: number): string {
    return `Browser ${String.fromCharCode('A'.charCodeAt(0) + index)}`;
}

export function formatAndroidLabel(index: number): string {
    return `Android ${String.fromCharCode('A'.charCodeAt(0) + index)}`;
}

export function formatTargetLabel(index: number, type: 'browser' | 'android'): string {
    return type === 'android' ? formatAndroidLabel(index) : formatBrowserLabel(index);
}

export function normalizeHeader(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function parseBooleanCell(value: string | undefined, defaultValue: boolean): boolean {
    if (!value) return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return defaultValue;
}

export function parseMaskedCell(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes' || normalized === 'true' || normalized === '1';
}

export function parseDimensionValue(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return undefined;
    }
    return parsed;
}

function normalizeCellValue(value: unknown): string | undefined {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return undefined;
}

export function getRowValue(row: Record<string, unknown>, candidates: string[]): string | undefined {
    const normalizedCandidates = new Set(candidates.map(normalizeHeader));
    for (const [key, value] of Object.entries(row)) {
        if (!normalizedCandidates.has(normalizeHeader(key))) {
            continue;
        }
        const normalizedValue = normalizeCellValue(value);
        if (normalizedValue !== undefined) {
            return normalizedValue;
        }
    }
    return undefined;
}

export function getRowMultilineValue(row: Record<string, unknown>, candidates: string[]): string | undefined {
    const normalizedCandidates = new Set(candidates.map(normalizeHeader));
    for (const [key, value] of Object.entries(row)) {
        if (!normalizedCandidates.has(normalizeHeader(key))) {
            continue;
        }
        if (typeof value === 'string') {
            return normalizeLineBreaks(value);
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
    }
    return undefined;
}

export function normalizeLineBreaks(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
