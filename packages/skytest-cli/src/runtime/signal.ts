export interface SignalSubscription {
    unsubscribe: () => void;
}

export function subscribeTerminationSignals(handler: (signal: NodeJS.Signals) => void): SignalSubscription {
    const bindings: Array<{ signal: NodeJS.Signals; listener: () => void }> = [
        {
            signal: 'SIGINT',
            listener: () => handler('SIGINT'),
        },
        {
            signal: 'SIGTERM',
            listener: () => handler('SIGTERM'),
        },
    ];

    for (const { signal, listener } of bindings) {
        process.on(signal, listener);
    }

    return {
        unsubscribe() {
            for (const { signal, listener } of bindings) {
                process.off(signal, listener);
            }
        },
    };
}
