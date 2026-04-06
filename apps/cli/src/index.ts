#!/usr/bin/env node

import { runDescribeRunnerCommand } from './commands/describe-runner';
import { runGetRunnersCommand } from './commands/get-runners';
import { runInitCommand } from './commands/init';
import { runLogsRunnerCommand } from './commands/logs-runner';
import { runPairRunnerCommand } from './commands/pair-runner';
import { runRunProjectCommand } from './commands/run-project';
import { runRunTestCaseCommand } from './commands/run-test-case';
import { runResetCommand } from './commands/reset';
import { runSyncRunnersCommand } from './commands/sync-runners';
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
        '  skytest init',
        '  skytest pair runner <pairing-token>',
        '  skytest start runner <runner-id> [--repair-token <pairing-token>]',
        '  skytest stop runner <runner-id>',
        '  skytest get runners [--json|--format text|json]',
        '  skytest sync runners [--json|--format text|json]',
        '  skytest describe runner <runner-id> [--json|--format text|json]',
        '  skytest logs runner <runner-id> [-f|--follow] [--tail <n>]',
        '  skytest unpair runner <runner-id>',
        '  skytest reset --force',
        '  skytest run test-case <display-id> --project-id <project-id> [--url <base-url>] [--api-key <token>|--token <token>] [--wait|--no-wait] [--timeout-ms <ms>] [--json|--format text|json]',
        '  skytest run project <project-id> [--display-id <display-id> ...] [--url <base-url>] [--api-key <token>|--token <token>] [--wait|--no-wait] [--timeout-ms <ms>] [--json|--format text|json]',
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

    if (command.kind === 'init') {
        await runInitCommand();
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

    if (command.kind === 'sync-runners') {
        await runSyncRunnersCommand({ format: command.format });
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

    if (command.kind === 'run-test-case') {
        await runRunTestCaseCommand({
            displayId: command.displayId,
            projectId: command.projectId,
            controlPlaneBaseUrl: command.controlPlaneBaseUrl,
            authToken: command.authToken,
            wait: command.wait,
            timeoutMs: command.timeoutMs,
            format: command.format,
        });
        return;
    }

    if (command.kind === 'run-project') {
        await runRunProjectCommand({
            projectId: command.projectId,
            displayIds: command.displayIds,
            controlPlaneBaseUrl: command.controlPlaneBaseUrl,
            authToken: command.authToken,
            wait: command.wait,
            timeoutMs: command.timeoutMs,
            format: command.format,
        });
        return;
    }

    await runResetCommand({ force: command.force });
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown CLI error';
    console.error(`Error: ${message}`);
    process.exitCode = 1;
});
