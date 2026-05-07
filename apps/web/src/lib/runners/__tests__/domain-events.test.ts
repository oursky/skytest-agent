import { describe, expect, it, vi } from 'vitest';
import {
    emitRunTerminal,
    subscribeRunTerminal,
} from '@/lib/runners/domain-events';

describe('domain-events run terminal bus', () => {
    it('delivers emitted events to subscribers', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeRunTerminal(listener);

        emitRunTerminal({
            runId: 'run-1',
            status: 'FAIL',
            testCaseId: 'tc-1',
            projectId: 'project-1',
        });

        expect(listener).toHaveBeenCalledWith({
            runId: 'run-1',
            status: 'FAIL',
            testCaseId: 'tc-1',
            projectId: 'project-1',
        });
        unsubscribe();
    });

    it('stops receiving events after unsubscribe', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeRunTerminal(listener);

        unsubscribe();
        emitRunTerminal({
            runId: 'run-2',
            status: 'PASS',
        });

        expect(listener).not.toHaveBeenCalled();
    });
});
