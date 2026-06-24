#!/usr/bin/env node

import { runDescribeRunnerCommand } from './commands/describe-runner';
import { runGetRunnersCommand } from './commands/get-runners';
import { runInitCommand } from './commands/init';
import { runLogsRunnerCommand } from './commands/logs-runner';
import { runLocalCommandGroup } from './commands/local';
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
        '  skytest-runner version',
        '  skytest-runner init',
        '  skytest-runner local setup',
        '  skytest-runner local up [-d|--detach] [--timeout-ms <ms>]',
        '  skytest-runner local down',
        '  skytest-runner local status',
        '  skytest-runner local update',
        '  skytest-runner pair runner <pairing-token>',
        '  skytest-runner start runner <runner-id> [--repair-token <pairing-token>]',
        '  skytest-runner stop runner <runner-id>',
        '  skytest-runner get runners [--json|--format text|json]',
        '  skytest-runner sync runners [--json|--format text|json]',
        '  skytest-runner describe runner <runner-id> [--json|--format text|json]',
        '  skytest-runner logs runner <runner-id> [-f|--follow] [--tail <n>]',
        '  skytest-runner unpair runner <runner-id>',
        '  skytest-runner reset --force',
        '  skytest-runner run test-case <display-id> --project-id <project-id> [--url <base-url>] [--api-key <token>|--token <token>] [--sync|--no-sync] [--sync-root <path>] [--wait|--no-wait] [--timeout-ms <ms>] [--reporter console|file] [--report-dir <path>] [--json|--format text|json]',
        '  skytest-runner run project <project-id> [--display-id <display-id> ...] [--concurrency <n>] [--url <base-url>] [--api-key <token>|--token <token>] [--sync|--no-sync] [--sync-root <path>] [--wait|--no-wait] [--timeout-ms <ms>] [--reporter console|file] [--report-dir <path>] [--json|--format text|json]',
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

    if (command.kind === 'local') {
        await runLocalCommandGroup({
            action: command.action,
            detach: command.detach,
            timeoutMs: command.timeoutMs,
        });
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
            syncBeforeRun: command.syncBeforeRun,
            syncRoot: command.syncRoot,
            wait: command.wait,
            timeoutMs: command.timeoutMs,
            reporter: command.reporter,
            reportDir: command.reportDir,
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
            syncBeforeRun: command.syncBeforeRun,
            syncRoot: command.syncRoot,
            concurrency: command.concurrency,
            wait: command.wait,
            timeoutMs: command.timeoutMs,
            reporter: command.reporter,
            reportDir: command.reportDir,
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
