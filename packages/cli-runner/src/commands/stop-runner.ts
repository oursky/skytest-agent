import { stopRunner } from '../runtime/runner-manager';
import { printValue } from './output';

interface StopRunnerOptions {
    runnerId: string;
}

export async function runStopRunnerCommand(options: StopRunnerOptions): Promise<void> {
    const stopped = await stopRunner(options.runnerId);
    printValue({
        command: 'stop runner',
        localRunnerId: stopped.localRunnerId,
        stopped: stopped.stopped,
        pid: stopped.pid,
        serverMarkedOffline: stopped.serverMarkedOffline,
    }, 'text');
}
