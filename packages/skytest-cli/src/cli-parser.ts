import { resolveOutputFormat } from './commands/output';

export type SkytestCliCommand =
    | { kind: 'help' }
    | { kind: 'pair-runner'; pairingToken: string; label?: string; controlPlaneBaseUrl?: string; autoStart: boolean }
    | { kind: 'start-runner'; runnerId: string }
    | { kind: 'stop-runner'; runnerId: string }
    | { kind: 'get-runners'; format: 'text' | 'json' }
    | { kind: 'describe-runner'; runnerId: string; format: 'text' | 'json' }
    | { kind: 'logs-runner'; runnerId: string; follow: boolean; tail: number | null }
    | { kind: 'unpair-runner'; runnerId: string }
    | { kind: 'reset'; force: boolean };

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

export function parseSkytestCliCommand(args: string[]): SkytestCliCommand {
    if (args.length === 0 || isHelpFlag(args[0])) {
        return { kind: 'help' };
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
        const runnerId = remainingArgs[0];
        if (!runnerId || isHelpFlag(runnerId)) {
            throw new Error('Usage: skytest start runner <runner-id>');
        }
        return { kind: 'start-runner', runnerId };
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

    throw new Error(`Unknown command: ${args.join(' ')}`);
}
