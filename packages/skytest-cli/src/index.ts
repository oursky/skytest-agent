#!/usr/bin/env node

import { runDescribeRunnerCommand } from './commands/describe-runner';
import { runGetRunnersCommand } from './commands/get-runners';
import { runLogsRunnerCommand } from './commands/logs-runner';
import { resolveOutputFormat } from './commands/output';
import { runPairRunnerCommand } from './commands/pair-runner';
import { runResetCommand } from './commands/reset';
import { runStartRunnerCommand } from './commands/start-runner';
import { runStopRunnerCommand } from './commands/stop-runner';
import { runUnpairRunnerCommand } from './commands/unpair-runner';

function printHelp(): void {
    console.log([
        'SkyTest CLI (work in progress)',
        '',
        'Usage:',
        '  skytest pair runner <pairing-token>',
        '  skytest start runner <runner-id>',
        '  skytest stop runner <runner-id>',
        '  skytest get runners [--json|--format text|json]',
        '  skytest describe runner <runner-id> [--json|--format text|json]',
        '  skytest logs runner <runner-id> [-f|--follow] [--tail <n>]',
        '  skytest unpair runner <runner-id>',
        '  skytest reset --force',
    ].join('\n'));
}

function isHelpFlag(token: string | undefined): boolean {
    return token === '--help' || token === '-h' || token === 'help';
}

function parseLogsArguments(args: string[]): { runnerId: string; follow: boolean; tail: number | null } {
    if (args.length === 0) {
        throw new Error('Missing <runner-id> for `logs runner`.');
    }

    const runnerId = args[0];
    let follow = false;
    let tail: number | null = null;

    for (let index = 1; index < args.length; index += 1) {
        const token = args[index];

        if (token === '--follow' || token === '-f') {
            follow = true;
            continue;
        }

        if (token === '--tail') {
            const tailValue = args[index + 1];
            if (!tailValue) {
                throw new Error('Missing value for `--tail`.');
            }
            const parsedTail = Number.parseInt(tailValue, 10);
            if (!Number.isInteger(parsedTail) || parsedTail <= 0) {
                throw new Error('`--tail` must be a positive integer.');
            }
            tail = parsedTail;
            index += 1;
            continue;
        }

        throw new Error(`Unknown option for \`logs runner\`: ${token}`);
    }

    return { runnerId, follow, tail };
}

function parsePairRunnerArguments(args: string[]): {
    pairingToken: string;
    label?: string;
    controlPlaneBaseUrl?: string;
    autoStart: boolean;
} {
    if (args.length === 0) {
        throw new Error('Usage: skytest pair runner <pairing-token>');
    }

    const pairingToken = args[0];
    let label: string | undefined;
    let controlPlaneBaseUrl: string | undefined;
    let autoStart = true;

    for (let index = 1; index < args.length; index += 1) {
        const token = args[index];

        if (token === '--no-start') {
            autoStart = false;
            continue;
        }

        if (token === '--label') {
            const value = args[index + 1];
            if (!value) {
                throw new Error('Missing value for `--label`.');
            }
            label = value;
            index += 1;
            continue;
        }

        if (token === '--control-plane-url') {
            const value = args[index + 1];
            if (!value) {
                throw new Error('Missing value for `--control-plane-url`.');
            }
            controlPlaneBaseUrl = value;
            index += 1;
            continue;
        }

        throw new Error(`Unknown option for \`pair runner\`: ${token}`);
    }

    return { pairingToken, label, controlPlaneBaseUrl, autoStart };
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.length === 0 || isHelpFlag(args[0])) {
        printHelp();
        return;
    }

    if (args[0] === 'reset') {
        const force = args.slice(1).includes('--force');
        await runResetCommand({ force });
        return;
    }

    const [action, resource, ...remainingArgs] = args;

    if (action === 'pair' && resource === 'runner') {
        if (remainingArgs.length === 0 || isHelpFlag(remainingArgs[0])) {
            throw new Error('Usage: skytest pair runner <pairing-token>');
        }
        await runPairRunnerCommand(parsePairRunnerArguments(remainingArgs));
        return;
    }

    if (action === 'start' && resource === 'runner') {
        const runnerId = remainingArgs[0];
        if (!runnerId || isHelpFlag(runnerId)) {
            throw new Error('Usage: skytest start runner <runner-id>');
        }
        await runStartRunnerCommand({ runnerId });
        return;
    }

    if (action === 'stop' && resource === 'runner') {
        const runnerId = remainingArgs[0];
        if (!runnerId || isHelpFlag(runnerId)) {
            throw new Error('Usage: skytest stop runner <runner-id>');
        }
        await runStopRunnerCommand({ runnerId });
        return;
    }

    if (action === 'get' && resource === 'runners') {
        const { format, remainingArgs: extraArgs } = resolveOutputFormat(remainingArgs);
        if (extraArgs.length > 0) {
            throw new Error(`Unknown argument(s) for \`get runners\`: ${extraArgs.join(', ')}`);
        }
        await runGetRunnersCommand({ format });
        return;
    }

    if (action === 'describe' && resource === 'runner') {
        const runnerId = remainingArgs[0];
        if (!runnerId || isHelpFlag(runnerId)) {
            throw new Error('Usage: skytest describe runner <runner-id>');
        }
        const { format, remainingArgs: extraArgs } = resolveOutputFormat(remainingArgs.slice(1));
        if (extraArgs.length > 0) {
            throw new Error(`Unknown argument(s) for \`describe runner\`: ${extraArgs.join(', ')}`);
        }
        await runDescribeRunnerCommand({ runnerId, format });
        return;
    }

    if (action === 'logs' && resource === 'runner') {
        const parsed = parseLogsArguments(remainingArgs);
        await runLogsRunnerCommand(parsed);
        return;
    }

    if (action === 'unpair' && resource === 'runner') {
        const runnerId = remainingArgs[0];
        if (!runnerId || isHelpFlag(runnerId)) {
            throw new Error('Usage: skytest unpair runner <runner-id>');
        }
        await runUnpairRunnerCommand({ runnerId });
        return;
    }

    throw new Error(`Unknown command: ${args.join(' ')}`);
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown CLI error';
    console.error(`Error: ${message}`);
    process.exitCode = 1;
});
