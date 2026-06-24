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

export interface RunSessionTerminalEvent {
    sessionId: string;
    status: RunTerminalStatus;
    kind: string;
    projectId?: string;
}

type RunSessionTerminalListener = (event: RunSessionTerminalEvent) => void;

const runSessionTerminalListeners = new Set<RunSessionTerminalListener>();

export function emitRunSessionTerminal(event: RunSessionTerminalEvent): void {
    for (const listener of [...runSessionTerminalListeners]) {
        listener(event);
    }
}

export function subscribeRunSessionTerminal(listener: RunSessionTerminalListener): () => void {
    runSessionTerminalListeners.add(listener);
    return () => {
        runSessionTerminalListeners.delete(listener);
    };
}
