import { unpairRunner } from '../runtime/runner-manager';
import { printValue } from './output';

interface UnpairRunnerOptions {
    runnerId: string;
}

export async function runUnpairRunnerCommand(options: UnpairRunnerOptions): Promise<void> {
    const unpaired = await unpairRunner(options.runnerId);
    printValue({
        command: 'unpair runner',
        localRunnerId: unpaired.localRunnerId,
        removed: unpaired.removed,
    }, 'text');
}
