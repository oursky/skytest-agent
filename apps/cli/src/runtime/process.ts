import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

interface StartProcessOptions {
    entryScriptPath: string;
    workingDirectory: string;
    logPath: string;
    env: NodeJS.ProcessEnv;
    useTsxLoader: boolean;
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

export function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export function startDetachedRunnerProcess(options: StartProcessOptions): number {
    const outputDescriptor = openSync(options.logPath, 'a');
    try {
        const args = options.useTsxLoader
            ? ['--import', 'tsx', options.entryScriptPath]
            : [options.entryScriptPath];
        const child = spawn(
            process.execPath,
            args,
            {
                cwd: options.workingDirectory,
                env: options.env,
                detached: true,
                stdio: ['ignore', outputDescriptor, outputDescriptor],
            }
        );

        if (!child.pid) {
            throw new Error('Failed to start runner process: missing pid.');
        }

        child.unref();
        return child.pid;
    } finally {
        closeSync(outputDescriptor);
    }
}

export async function stopProcessWithTimeout(
    pid: number,
    timeoutMs: number
): Promise<'stopped' | 'not-running' | 'failed'> {
    if (!isProcessAlive(pid)) {
        return 'not-running';
    }

    try {
        process.kill(pid, 'SIGTERM');
    } catch {
        return 'not-running';
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isProcessAlive(pid)) {
            return 'stopped';
        }
        await sleep(200);
    }

    if (isProcessAlive(pid)) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            return 'not-running';
        }
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
        if (!isProcessAlive(pid)) {
            return 'stopped';
        }
        await sleep(100);
    }

    return isProcessAlive(pid) ? 'failed' : 'stopped';
}
