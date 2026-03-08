import { pairRunner } from '../runtime/runner-manager';
import { printValue } from './output';

interface PairRunnerOptions {
    pairingToken: string;
    label?: string;
    controlPlaneBaseUrl?: string;
    autoStart: boolean;
}

export async function runPairRunnerCommand(options: PairRunnerOptions): Promise<void> {
    const paired = await pairRunner(options);
    printValue({
        command: 'pair runner',
        localRunnerId: paired.localRunnerId,
        serverRunnerId: paired.serverRunnerId,
        label: paired.label,
        controlPlaneBaseUrl: paired.controlPlaneBaseUrl,
        started: paired.started,
        pid: paired.pid,
    }, 'text');
}
