import { printValue } from './output';

interface LogsRunnerOptions {
    runnerId: string;
    follow: boolean;
    tail: number | null;
}

export async function runLogsRunnerCommand(options: LogsRunnerOptions): Promise<void> {
    printValue(
        {
            command: 'logs runner',
            runnerId: options.runnerId,
            follow: options.follow,
            tail: options.tail,
            status: 'planned',
            message: 'Runner logs implementation is in progress.',
        },
        'text'
    );
}
