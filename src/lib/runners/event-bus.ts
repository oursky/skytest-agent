type RunUpdateListener = () => void;

const listenersByRunId = new Map<string, Set<RunUpdateListener>>();

export function subscribeRunUpdates(runId: string, listener: RunUpdateListener): () => void {
    const listeners = listenersByRunId.get(runId) ?? new Set<RunUpdateListener>();
    listeners.add(listener);
    listenersByRunId.set(runId, listeners);

    return () => {
        const registered = listenersByRunId.get(runId);
        if (!registered) {
            return;
        }

        registered.delete(listener);
        if (registered.size === 0) {
            listenersByRunId.delete(runId);
        }
    };
}

export function publishRunUpdate(runId: string): void {
    const listeners = listenersByRunId.get(runId);
    if (!listeners) {
        return;
    }

    for (const listener of listeners) {
        listener();
    }
}
