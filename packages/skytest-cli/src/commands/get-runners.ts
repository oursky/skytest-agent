import { type OutputFormat, printValue } from './output';

interface GetRunnersOptions {
    format: OutputFormat;
}

export async function runGetRunnersCommand(options: GetRunnersOptions): Promise<void> {
    const payload = {
        command: 'get runners',
        status: 'planned',
        runners: [] as Array<Record<string, string>>,
        message: 'Runner listing implementation is in progress.',
    };

    printValue(payload, options.format);
}
