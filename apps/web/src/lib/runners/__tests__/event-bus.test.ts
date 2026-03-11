import { describe, expect, it, vi } from 'vitest';
import { publishRunUpdate, subscribeRunUpdates } from '@/lib/runners/event-bus';

describe('event-bus', () => {
    it('notifies subscribed listeners and unsubscribes cleanly', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeRunUpdates('run-1', listener);

        publishRunUpdate('run-1');
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        publishRunUpdate('run-1');
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
