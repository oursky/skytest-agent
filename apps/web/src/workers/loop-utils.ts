interface LoggerLike {
    info(message: string): void;
}

export interface WakeableSleeper {
    sleepOrWake(ms: number): Promise<void>;
    wake(): void;
}

export function createWakeableSleeper(): WakeableSleeper {
    let wakeLoop: (() => void) | null = null;

    return {
        sleepOrWake(ms: number): Promise<void> {
            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    wakeLoop = null;
                    resolve();
                }, ms);

                wakeLoop = () => {
                    clearTimeout(timeout);
                    wakeLoop = null;
                    resolve();
                };
            });
        },
        wake(): void {
            wakeLoop?.();
        },
    };
}

export interface WorkerShutdownController {
    isShutdownRequested(): boolean;
    requestShutdown(signal: NodeJS.Signals): void;
}

export function createWorkerShutdownController(input: {
    logger: LoggerLike;
    workerLabel: string;
    wake: () => void;
}): WorkerShutdownController {
    let shutdownRequested = false;

    return {
        isShutdownRequested(): boolean {
            return shutdownRequested;
        },
        requestShutdown(signal: NodeJS.Signals): void {
            if (shutdownRequested) {
                return;
            }

            shutdownRequested = true;
            input.logger.info(`Received ${signal}, shutting down ${input.workerLabel}`);
            input.wake();
        },
    };
}
