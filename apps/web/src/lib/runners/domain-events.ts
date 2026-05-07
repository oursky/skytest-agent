import type { RunTerminalStatus } from '@/types';

export interface RunTerminalEvent {
    runId: string;
    status: RunTerminalStatus;
    testCaseId?: string;
    projectId?: string;
}

type RunTerminalListener = (event: RunTerminalEvent) => void;

const runTerminalListeners = new Set<RunTerminalListener>();

export function emitRunTerminal(event: RunTerminalEvent): void {
    for (const listener of [...runTerminalListeners]) {
        listener(event);
    }
}

export function subscribeRunTerminal(listener: RunTerminalListener): () => void {
    runTerminalListeners.add(listener);
    return () => {
        runTerminalListeners.delete(listener);
    };
}
