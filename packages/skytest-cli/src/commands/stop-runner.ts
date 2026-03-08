import { printValue } from './output';

interface StopRunnerOptions {
    runnerId: string;
}

export async function runStopRunnerCommand(options: StopRunnerOptions): Promise<void> {
    printValue(
        {
            command: 'stop runner',
            runnerId: options.runnerId,
            status: 'planned',
            message: 'Runner stop implementation is in progress.',
        },
        'text'
    );
}
