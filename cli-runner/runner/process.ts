interface SignalHandlerRegistration {
    unregister: () => void;
}

export function registerTerminationSignalHandlers(onSignal: (signal: NodeJS.Signals) => void): SignalHandlerRegistration {
    const handlers: Array<{ signal: NodeJS.Signals; handler: () => void }> = [
        {
            signal: 'SIGINT',
            handler: () => onSignal('SIGINT'),
        },
        {
            signal: 'SIGTERM',
            handler: () => onSignal('SIGTERM'),
        },
    ];

    for (const { signal, handler } of handlers) {
        process.on(signal, handler);
    }

    return {
        unregister() {
            for (const { signal, handler } of handlers) {
                process.off(signal, handler);
            }
        },
    };
}
