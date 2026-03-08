import { startRunnerEngine, requestRunnerStop } from './engine';
import { registerTerminationSignalHandlers } from './process';

const registration = registerTerminationSignalHandlers((signal) => {
    requestRunnerStop(`Stopping runner due to ${signal}`);
});

void startRunnerEngine().catch((error: unknown) => {
    requestRunnerStop();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Runner failed to start: ${message}`);
    process.exitCode = 1;
}).finally(() => {
    registration.unregister();
});
