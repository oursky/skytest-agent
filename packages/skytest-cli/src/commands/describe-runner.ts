import { type OutputFormat, printValue } from './output';

interface DescribeRunnerOptions {
    runnerId: string;
    format: OutputFormat;
}

export async function runDescribeRunnerCommand(options: DescribeRunnerOptions): Promise<void> {
    const payload = {
        command: 'describe runner',
        status: 'planned',
        runner: {
            id: options.runnerId,
        },
        message: 'Runner describe implementation is in progress.',
    };

    printValue(payload, options.format);
}
