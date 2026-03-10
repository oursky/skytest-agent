import { isLogData, isScreenshotData, type TestEvent } from '@/types';

const MASKED_TEXT = '****';

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMaskedValues(maskedValues: readonly string[]): string[] {
    const uniqueValues = new Set<string>();

    for (const value of maskedValues) {
        if (!value) {
            continue;
        }
        uniqueValues.add(value);
    }

    return Array.from(uniqueValues).sort((a, b) => b.length - a.length);
}

export function createExactValueMasker(maskedValues: readonly string[]): (text: string) => string {
    const normalizedValues = normalizeMaskedValues(maskedValues);
    if (normalizedValues.length === 0) {
        return (text: string) => text;
    }

    const pattern = new RegExp(normalizedValues.map((value) => escapeRegExp(value)).join('|'), 'g');
    return (text: string) => text.replace(pattern, MASKED_TEXT);
}

export function maskEventForViewer(event: TestEvent, maskText: (text: string) => string): TestEvent {
    if (event.type === 'log' && isLogData(event.data)) {
        const maskedMessage = maskText(event.data.message);
        if (maskedMessage === event.data.message) {
            return event;
        }

        return {
            ...event,
            data: {
                ...event.data,
                message: maskedMessage,
            },
        };
    }

    if (event.type === 'screenshot' && isScreenshotData(event.data)) {
        const maskedLabel = maskText(event.data.label);
        if (maskedLabel === event.data.label) {
            return event;
        }

        return {
            ...event,
            data: {
                ...event.data,
                label: maskedLabel,
            },
        };
    }

    return event;
}

export function maskNullableText(
    value: string | null,
    maskText: (text: string) => string
): string | null {
    return value === null ? null : maskText(value);
}

export function maskOptionalText(
    value: string | undefined,
    maskText: (text: string) => string
): string | undefined {
    return value === undefined ? undefined : maskText(value);
}
