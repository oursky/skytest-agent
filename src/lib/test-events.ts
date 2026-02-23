import { TestEvent } from '@/types';

export function isTestEvent(value: unknown): value is TestEvent {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const event = value as Partial<TestEvent> & { data?: unknown };
    const hasValidType = event.type === 'log' || event.type === 'screenshot';
    return hasValidType && typeof event.timestamp === 'number' && typeof event.data === 'object' && event.data !== null;
}

export function parseStoredEvents(stored: string | null | undefined): TestEvent[] {
    if (!stored) {
        return [];
    }

    const trimmed = stored.trim();
    if (!trimmed) {
        return [];
    }

    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            return parsed.filter(isTestEvent);
        }
    } catch {
        // Fallback to NDJSON parsing.
    }

    const events: TestEvent[] = [];
    for (const line of trimmed.split('\n')) {
        const eventLine = line.trim();
        if (!eventLine) {
            continue;
        }

        try {
            const parsed = JSON.parse(eventLine);
            if (isTestEvent(parsed)) {
                events.push(parsed);
            }
        } catch {
            // Ignore malformed lines to keep parsing resilient.
        }
    }

    return events;
}
