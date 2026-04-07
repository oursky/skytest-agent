import { resolveOutputFormat } from './commands/output';

export type SkytestCliCommand =
    | { kind: 'help' }
    | { kind: 'version' }
    | { kind: 'init' }
    | { kind: 'pair-runner'; pairingToken: string; label?: string; controlPlaneBaseUrl?: string; autoStart: boolean }
    | { kind: 'start-runner'; runnerId: string; repairPairingToken?: string }
    | { kind: 'stop-runner'; runnerId: string }
    | { kind: 'get-runners'; format: 'text' | 'json' }
    | { kind: 'sync-runners'; format: 'text' | 'json' }
    | { kind: 'describe-runner'; runnerId: string; format: 'text' | 'json' }
    | { kind: 'logs-runner'; runnerId: string; follow: boolean; tail: number | null }
    | { kind: 'unpair-runner'; runnerId: string }
    | { kind: 'reset'; force: boolean }
    | {
        kind: 'run-test-case';
        displayId: string;
        projectId: string;
        controlPlaneBaseUrl?: string;
        authToken?: string;
        syncBeforeRun?: boolean;
        syncRoot?: string;
        wait: boolean;
        timeoutMs: number;
        format: 'text' | 'json';
    }
    | {
        kind: 'run-project';
        projectId: string;
        controlPlaneBaseUrl?: string;
        authToken?: string;
        syncBeforeRun?: boolean;
        syncRoot?: string;
        displayIds: string[];
        concurrency: number;
        wait: boolean;
        timeoutMs: number;
        format: 'text' | 'json';
    };

interface ParsedRunOptions {
    projectId: string;
    controlPlaneBaseUrl?: string;
    authToken?: string;
    syncBeforeRun?: boolean;
    syncRoot?: string;
    wait: boolean;
    timeoutMs: number;
    format: 'text' | 'json';
}

interface ParsedRunProjectOptions extends ParsedRunOptions {
    displayIds: string[];
    concurrency: number;
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

        if (token === '--url') {
            const value = args[index + 1];
            if (!value) {
                throw new Error('Missing value for `--url`.');
            }
            controlPlaneBaseUrl = value;
            index += 1;
            continue;
        }

        throw new Error(`Unknown option for \`pair runner\`: ${token}`);
    }

    return { pairingToken, label, controlPlaneBaseUrl, autoStart };
}

function parseStartRunnerArguments(args: string[]): { runnerId: string; repairPairingToken?: string } {
    const runnerId = args[0];
    if (!runnerId || isHelpFlag(runnerId)) {
        throw new Error('Usage: skytest start runner <runner-id>');
    }

    let repairPairingToken: string | undefined;
    for (let index = 1; index < args.length; index += 1) {
        const token = args[index];
        if (token === '--repair-token') {
            const value = args[index + 1];
            if (!value) {
                throw new Error('Missing value for `--repair-token`.');
            }
            repairPairingToken = value;
            index += 1;
            continue;
        }
        throw new Error(`Unknown option for \`start runner\`: ${token}`);
    }

    return { runnerId, repairPairingToken };
}

function parseRunOptions(args: string[]): ParsedRunOptions {
    let projectId = '';
    let controlPlaneBaseUrl: string | undefined;
    let authToken: string | undefined;
    let syncBeforeRun = true;
    let syncRoot: string | undefined;
    let wait = true;
    let timeoutMs = 600000;
    let format: 'text' | 'json' = 'text';

    for (let index = 0; index < args.length; index += 1) {
        const token = args[index];

        if (token === '--project-id') {
            const value = args[index + 1];
            if (!value) {
                throw new Error('Missing value for `--project-id`.');
            }
            projectId = value;
            index += 1;
            continue;
        }

        if (token === '--url') {
            const value = args[index + 1];
            if (!value) {
                throw new Error('Missing value for `--url`.');
            }
            controlPlaneBaseUrl = value;
            index += 1;
            continue;
        }

        if (token === '--api-key' || token === '--token') {
            const value = args[index + 1];
            if (!value) {
                throw new Error(`Missing value for \`${token}\`.`);
            }
            authToken = value;
            index += 1;
            continue;
        }

        if (token === '--sync') {
            syncBeforeRun = true;
            continue;
        }

        if (token === '--no-sync') {
            syncBeforeRun = false;
            continue;
        }

        if (token === '--sync-root') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error('Missing value for `--sync-root`.');
            }
            syncRoot = value;
            index += 1;
            continue;
        }

        if (token === '--wait') {
            wait = true;
            continue;
        }

        if (token === '--no-wait') {
            wait = false;
            continue;
        }

        if (token === '--timeout-ms') {
            const value = args[index + 1];
            if (!value) {
                throw new Error('Missing value for `--timeout-ms`.');
            }
            const parsed = Number.parseInt(value, 10);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new Error('`--timeout-ms` must be a positive integer.');
            }
            timeoutMs = parsed;
            index += 1;
            continue;
        }

        if (token === '--json') {
            format = 'json';
            continue;
        }

        if (token === '--format') {
            const value = args[index + 1];
            if (value !== 'text' && value !== 'json') {
                throw new Error('Expected `json` or `text` after `--format`.');
            }
            format = value;
            index += 1;
            continue;
        }

        throw new Error(`Unknown option for \`run\`: ${token}`);
    }

    if (!projectId.trim()) {
        throw new Error('`--project-id` is required for `run` commands.');
    }

    const parsed: ParsedRunOptions = {
        projectId,
        controlPlaneBaseUrl,
        authToken,
        wait,
        timeoutMs,
        format,
    };

    if (!syncBeforeRun) {
        parsed.syncBeforeRun = false;
    }

    if (syncRoot) {
        parsed.syncRoot = syncRoot;
    }

    return parsed;
}

function parseRunProjectOptions(args: string[]): ParsedRunProjectOptions {
    const displayIds: string[] = [];
    const delegatedArgs: string[] = [];
    let concurrency = 1;

    for (let index = 0; index < args.length; index += 1) {
        const token = args[index];

        if (token === '--display-id') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error('Missing value for `--display-id`.');
            }
            displayIds.push(value);
            index += 1;
            continue;
        }

        if (token === '--concurrency') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error('Missing value for `--concurrency`.');
            }
            const parsed = Number.parseInt(value, 10);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new Error('`--concurrency` must be a positive integer.');
            }
            concurrency = parsed;
            index += 1;
            continue;
        }

        if (token.startsWith('--display-id=')) {
            const value = token.slice('--display-id='.length);
            if (!value) {
                throw new Error('Missing value for `--display-id`.');
            }
            displayIds.push(value);
            continue;
        }

        if (token.startsWith('--concurrency=')) {
            const value = token.slice('--concurrency='.length);
            const parsed = Number.parseInt(value, 10);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new Error('`--concurrency` must be a positive integer.');
            }
            concurrency = parsed;
            continue;
        }

        if (token !== '--display-id') {
            delegatedArgs.push(token);
            continue;
        }
    }

    return {
        ...parseRunOptions(delegatedArgs),
        displayIds,
        concurrency,
    };
}

export function parseSkytestCliCommand(args: string[]): SkytestCliCommand {
    if (args.length === 0 || isHelpFlag(args[0])) {
        return { kind: 'help' };
    }

    if (args[0] === 'version') {
        return { kind: 'version' };
    }

    if (args[0] === 'init') {
        if (args.length > 1) {
            throw new Error(`Unknown argument(s) for \`init\`: ${args.slice(1).join(', ')}`);
        }
        return { kind: 'init' };
    }

    if (args[0] === 'reset') {
        return { kind: 'reset', force: args.slice(1).includes('--force') };
    }

    const [action, resource, ...remainingArgs] = args;

    if (action === 'pair' && resource === 'runner') {
        if (remainingArgs.length === 0 || isHelpFlag(remainingArgs[0])) {
            throw new Error('Usage: skytest pair runner <pairing-token>');
        }
        const parsed = parsePairRunnerArguments(remainingArgs);
        return { kind: 'pair-runner', ...parsed };
    }

    if (action === 'start' && resource === 'runner') {
        const parsed = parseStartRunnerArguments(remainingArgs);
        return { kind: 'start-runner', ...parsed };
    }

    if (action === 'stop' && resource === 'runner') {
        const runnerId = remainingArgs[0];
        if (!runnerId || isHelpFlag(runnerId)) {
            throw new Error('Usage: skytest stop runner <runner-id>');
        }
        return { kind: 'stop-runner', runnerId };
    }

    if (action === 'get' && resource === 'runners') {
        const { format, remainingArgs: extraArgs } = resolveOutputFormat(remainingArgs);
        if (extraArgs.length > 0) {
            throw new Error(`Unknown argument(s) for \`get runners\`: ${extraArgs.join(', ')}`);
        }
        return { kind: 'get-runners', format };
    }

    if (action === 'sync' && resource === 'runners') {
        const { format, remainingArgs: extraArgs } = resolveOutputFormat(remainingArgs);
        if (extraArgs.length > 0) {
            throw new Error(`Unknown argument(s) for \`sync runners\`: ${extraArgs.join(', ')}`);
        }
        return { kind: 'sync-runners', format };
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
        return { kind: 'describe-runner', runnerId, format };
    }

    if (action === 'logs' && resource === 'runner') {
        const parsed = parseLogsArguments(remainingArgs);
        return { kind: 'logs-runner', ...parsed };
    }

    if (action === 'unpair' && resource === 'runner') {
        const runnerId = remainingArgs[0];
        if (!runnerId || isHelpFlag(runnerId)) {
            throw new Error('Usage: skytest unpair runner <runner-id>');
        }
        return { kind: 'unpair-runner', runnerId };
    }

    if (action === 'run' && resource === 'test-case') {
        const displayId = remainingArgs[0];
        if (!displayId || isHelpFlag(displayId) || displayId.startsWith('--')) {
            throw new Error('Usage: skytest run test-case <display-id> --project-id <project-id> [options]');
        }
        const options = parseRunOptions(remainingArgs.slice(1));
        return {
            kind: 'run-test-case',
            displayId,
            ...options,
        };
    }

    if (action === 'run' && resource === 'project') {
        const projectId = remainingArgs[0];
        if (!projectId || isHelpFlag(projectId) || projectId.startsWith('--')) {
            throw new Error('Usage: skytest run project <project-id> [options]');
        }
        const options = parseRunProjectOptions(['--project-id', projectId, ...remainingArgs.slice(1)]);
        return {
            kind: 'run-project',
            ...options,
        };
    }

    throw new Error(`Unknown command: ${args.join(' ')}`);
}
