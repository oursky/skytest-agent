import { createLogger } from '@/lib/logger';

const logger = createLogger('project-events');

export interface ProjectRunStatusEvent {
    type: 'test-run-status';
    testCaseId: string;
    runId: string;
    status: string;
}

type Listener = (event: ProjectRunStatusEvent) => void;

const listenersByProjectId = new Map<string, Set<Listener>>();

export function publishProjectEvent(projectId: string, event: ProjectRunStatusEvent) {
    const listeners = listenersByProjectId.get(projectId);
    if (!listeners || listeners.size === 0) return;

    for (const listener of listeners) {
        try {
            listener(event);
        } catch (error) {
            logger.warn('Listener failed', error);
        }
    }
}

export function subscribeProjectEvents(projectId: string, listener: Listener): () => void {
    let listeners = listenersByProjectId.get(projectId);
    if (!listeners) {
        listeners = new Set<Listener>();
        listenersByProjectId.set(projectId, listeners);
    }

    listeners.add(listener);

    return () => {
        const current = listenersByProjectId.get(projectId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) {
            listenersByProjectId.delete(projectId);
        }
    };
}
