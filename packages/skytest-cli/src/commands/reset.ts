import { resetAllRunners } from '../runtime/runner-manager';
import { printValue } from './output';

interface ResetOptions {
    force: boolean;
}

export async function runResetCommand(options: ResetOptions): Promise<void> {
    const result = await resetAllRunners(options.force);
    printValue({
        command: 'reset',
        removedRunners: result.removedRunners,
    }, 'text');
}
