import { startRunner } from '../runtime/runner-manager';
import { printValue } from './output';

interface StartRunnerOptions {
    runnerId: string;
}

export async function runStartRunnerCommand(options: StartRunnerOptions): Promise<void> {
    const started = await startRunner(options.runnerId);
    printValue({
        command: 'start runner',
        localRunnerId: started.localRunnerId,
        pid: started.pid,
        alreadyRunning: started.alreadyRunning,
        logPath: started.logPath,
    }, 'text');
}
