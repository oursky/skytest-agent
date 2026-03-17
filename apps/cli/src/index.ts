#!/usr/bin/env node

import { runDescribeRunnerCommand } from './commands/describe-runner';
import { runGetRunnersCommand } from './commands/get-runners';
import { runLogsRunnerCommand } from './commands/logs-runner';
import { runPairRunnerCommand } from './commands/pair-runner';
import { runResetCommand } from './commands/reset';
import { runStartRunnerCommand } from './commands/start-runner';
import { runStopRunnerCommand } from './commands/stop-runner';
import { runUnpairRunnerCommand } from './commands/unpair-runner';
import { parseSkytestCliCommand } from './cli-parser';

function printHelp(): void {
    console.log([
        'SkyTest CLI (work in progress)',
        '',
        'Usage:',
        '  skytest version',
        '  skytest pair runner <pairing-token>',
        '  skytest start runner <runner-id> [--repair-token <pairing-token>]',
        '  skytest stop runner <runner-id>',
        '  skytest get runners [--json|--format text|json]',
        '  skytest describe runner <runner-id> [--json|--format text|json]',
        '  skytest logs runner <runner-id> [-f|--follow] [--tail <n>]',
        '  skytest unpair runner <runner-id>',
        '  skytest reset --force',
    ].join('\n'));
}

function resolveCliVersion(): string {
    const version = process.env.SKYTEST_CLI_VERSION ?? process.env.npm_package_version;
    if (!version || version.trim().length === 0) {
        return 'dev';
    }
    return version;
}

async function main(): Promise<void> {
    const command = parseSkytestCliCommand(process.argv.slice(2));

    if (command.kind === 'help') {
        printHelp();
        return;
    }

    if (command.kind === 'version') {
        console.log(resolveCliVersion());
        return;
    }

    if (command.kind === 'pair-runner') {
        await runPairRunnerCommand({
            pairingToken: command.pairingToken,
            label: command.label,
            controlPlaneBaseUrl: command.controlPlaneBaseUrl,
            autoStart: command.autoStart,
        });
        return;
    }

    if (command.kind === 'start-runner') {
        await runStartRunnerCommand({
            runnerId: command.runnerId,
            repairPairingToken: command.repairPairingToken,
        });
        return;
    }

    if (command.kind === 'stop-runner') {
        await runStopRunnerCommand({ runnerId: command.runnerId });
        return;
    }

    if (command.kind === 'get-runners') {
        await runGetRunnersCommand({ format: command.format });
        return;
    }

    if (command.kind === 'describe-runner') {
        await runDescribeRunnerCommand({ runnerId: command.runnerId, format: command.format });
        return;
    }

    if (command.kind === 'logs-runner') {
        await runLogsRunnerCommand({
            runnerId: command.runnerId,
            follow: command.follow,
            tail: command.tail,
        });
        return;
    }

    if (command.kind === 'unpair-runner') {
        await runUnpairRunnerCommand({ runnerId: command.runnerId });
        return;
    }

    await runResetCommand({ force: command.force });
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown CLI error';
    console.error(`Error: ${message}`);
    process.exitCode = 1;
});
