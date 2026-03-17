import { startRunner } from '../runtime/runner-manager';
import { printValue } from './output';

interface StartRunnerOptions {
    runnerId: string;
    repairPairingToken?: string;
}

export async function runStartRunnerCommand(options: StartRunnerOptions): Promise<void> {
    const started = await startRunner(options.runnerId, {
        repairPairingToken: options.repairPairingToken,
    });
    printValue({
        command: 'start runner',
        localRunnerId: started.localRunnerId,
        pid: started.pid,
        alreadyRunning: started.alreadyRunning,
        autoRepaired: started.autoRepaired,
        logPath: started.logPath,
    }, 'text');
}
