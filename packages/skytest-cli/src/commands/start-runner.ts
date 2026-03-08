import { printValue } from './output';

interface StartRunnerOptions {
    runnerId: string;
}

export async function runStartRunnerCommand(options: StartRunnerOptions): Promise<void> {
    printValue(
        {
            command: 'start runner',
            runnerId: options.runnerId,
            status: 'planned',
            message: 'Runner start implementation is in progress.',
        },
        'text'
    );
}
