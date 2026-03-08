import { printValue } from './output';

interface UnpairRunnerOptions {
    runnerId: string;
}

export async function runUnpairRunnerCommand(options: UnpairRunnerOptions): Promise<void> {
    printValue(
        {
            command: 'unpair runner',
            runnerId: options.runnerId,
            status: 'planned',
            message: 'Runner unpair implementation is in progress.',
        },
        'text'
    );
}
