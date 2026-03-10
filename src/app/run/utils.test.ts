import { describe, expect, it } from 'vitest';
import {
    appendRunStreamEvent,
    applyRunStreamStatusUpdate,
    type RunViewerResult,
    type RunStreamStatusUpdate,
} from './utils';

function createInitialResult(): RunViewerResult {
    return {
        status: 'RUNNING',
        events: [
            {
                type: 'log',
                data: { message: 'step started', level: 'info' },
                timestamp: 1,
            },
        ],
    };
}

describe('run stream updates', () => {
    it('keeps existing events when terminal status arrives', () => {
        const previous = createInitialResult();
        const statusUpdate: RunStreamStatusUpdate = {
            type: 'status',
            status: 'FAIL',
            error: 'assertion failed',
        };

        const { next, shouldStopLoading } = applyRunStreamStatusUpdate(previous, statusUpdate);

        expect(shouldStopLoading).toBe(true);
        expect(next.status).toBe('FAIL');
        expect(next.error).toBe('assertion failed');
        expect(next.events).toEqual(previous.events);
    });

    it('allows trailing events after terminal status', () => {
        const previous = createInitialResult();
        const statusUpdate: RunStreamStatusUpdate = {
            type: 'status',
            status: 'FAIL',
            error: 'assertion failed',
        };
        const { next } = applyRunStreamStatusUpdate(previous, statusUpdate);

        const afterEvent = appendRunStreamEvent(next, {
            type: 'screenshot',
            data: { src: 'https://example.com/shot.png', label: 'final state' },
            timestamp: 2,
        });

        expect(afterEvent.events).toHaveLength(2);
        expect(afterEvent.events[1]).toMatchObject({
            type: 'screenshot',
            data: { label: 'final state' },
        });
    });

    it('does not stop loading for non-terminal status', () => {
        const previous = createInitialResult();
        const statusUpdate: RunStreamStatusUpdate = {
            type: 'status',
            status: 'RUNNING',
        };

        const { shouldStopLoading } = applyRunStreamStatusUpdate(previous, statusUpdate);
        expect(shouldStopLoading).toBe(false);
    });
});
