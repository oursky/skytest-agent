import { spawn } from 'node:child_process';
import { readRunnerLog } from '../runtime/runner-manager';
import { subscribeTerminationSignals } from '../runtime/signal';
import { resolveRunnerPaths } from '../state/store';
import { printValue } from './output';

interface LogsRunnerOptions {
    runnerId: string;
    follow: boolean;
    tail: number | null;
}

export async function runLogsRunnerCommand(options: LogsRunnerOptions): Promise<void> {
    const logContent = await readRunnerLog(options.runnerId);
    const tailLineCount = options.tail ?? 100;
    const tailedContent = logContent
        .split('\n')
        .slice(-tailLineCount)
        .join('\n')
        .trim();

    if (!options.follow) {
        if (tailedContent.length === 0) {
            printValue(`No logs available for runner '${options.runnerId}'.`, 'text');
            return;
        }
        process.stdout.write(`${tailedContent}\n`);
        return;
    }

    const logPath = resolveRunnerPaths(options.runnerId).logPath;
    const tailCommand = spawn('tail', ['-n', String(tailLineCount), '-f', logPath], {
        stdio: 'inherit',
    });
    const signalSubscription = subscribeTerminationSignals(() => {
        tailCommand.kill('SIGTERM');
    });

    await new Promise<void>((resolve, reject) => {
        tailCommand.on('error', (error) => {
            signalSubscription.unsubscribe();
            reject(error);
        });
        tailCommand.on('exit', (code) => {
            signalSubscription.unsubscribe();
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`tail process exited with code ${code ?? -1}`));
        });
    });
}
