import { describe, expect, it } from 'vitest';
import {
    appendRunStreamEvent,
    applyRunStreamStatusUpdate,
    mergeRunFormData,
    runDetailSnapshotToResult,
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

    it('creates a viewer result from an authoritative run snapshot', () => {
        const snapshot = runDetailSnapshotToResult({
            status: 'PASS',
            events: [
                {
                    type: 'log',
                    data: { message: 'done', level: 'success' },
                    timestamp: 3,
                },
            ],
            error: null,
            errorCode: null,
            errorCategory: null,
        });

        expect(snapshot).toEqual({
            status: 'PASS',
            events: [
                {
                    type: 'log',
                    data: { message: 'done', level: 'success' },
                    timestamp: 3,
                },
            ],
            error: undefined,
            errorCode: undefined,
            errorCategory: undefined,
        });
    });
});

describe('mergeRunFormData', () => {
    it('keeps fallback values when snapshot omits them', () => {
        const merged = mergeRunFormData({
            snapshot: {
                url: 'https://run.example',
                prompt: 'run prompt',
            },
            fallback: {
                name: 'Checkout flow',
                displayId: 'TC-100',
                steps: [],
            },
        });

        expect(merged).toEqual({
            url: 'https://run.example',
            prompt: 'run prompt',
            name: 'Checkout flow',
            displayId: 'TC-100',
            steps: [],
            browserConfig: undefined,
        });
    });

    it('prefers snapshot values when present', () => {
        const merged = mergeRunFormData({
            snapshot: {
                name: 'Snapshot name',
                displayId: 'SNAP-1',
                url: 'https://snapshot.example',
                prompt: 'snapshot prompt',
            },
            fallback: {
                name: 'Fallback name',
                displayId: 'FB-1',
                url: 'https://fallback.example',
                prompt: 'fallback prompt',
            },
        });

        expect(merged.name).toBe('Snapshot name');
        expect(merged.displayId).toBe('SNAP-1');
        expect(merged.url).toBe('https://snapshot.example');
        expect(merged.prompt).toBe('snapshot prompt');
    });

    it('uses previous values when both snapshot and fallback are missing', () => {
        const merged = mergeRunFormData({
            previous: {
                name: 'Previous name',
                displayId: 'PREV-1',
                url: 'https://prev.example',
                prompt: 'previous prompt',
            },
        });

        expect(merged).toEqual({
            name: 'Previous name',
            displayId: 'PREV-1',
            url: 'https://prev.example',
            prompt: 'previous prompt',
            steps: undefined,
            browserConfig: undefined,
        });
    });
});
