import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface LocalCommandOptions {
    action: 'setup' | 'up' | 'down' | 'status' | 'update';
    detach?: boolean;
    timeoutMs?: number;
}

interface CommandResult {
    stdout: string;
}

const DEFAULT_DETACH_TIMEOUT_MS = 180000;

function resolveWorkspaceRoot(): string {
    const currentFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(currentFile), '../../../../');
}

async function runLocalCommand(command: string, args: string[]): Promise<CommandResult> {
    return await new Promise<CommandResult>((resolve, reject) => {
        execFile(command, args, {
            cwd: resolveWorkspaceRoot(),
            env: process.env,
            maxBuffer: 1024 * 1024,
        }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }

            resolve({
                stdout: stdout ?? '',
            });
        });
    });
}

async function runMakeTarget(target: string): Promise<CommandResult> {
    return await runLocalCommand('make', [target]);
}

async function runShellStatusCommand(command: string): Promise<CommandResult> {
    return await runLocalCommand('sh', ['-c', command]);
}

async function tryRunShellStatusCommand(command: string): Promise<CommandResult | null> {
    try {
        return await runShellStatusCommand(command);
    } catch {
        return null;
    }
}

function collectComposeServiceNames(composePsOutput: string): string[] {
    const lines = composePsOutput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    if (lines.length <= 1) {
        return [];
    }

    return lines.slice(1).map((line) => line.split(/\s+/)[0]).filter((name) => name.length > 0);
}

function printCompletedStep(label: string): void {
    console.log(`- ${label}`);
}

async function runSetupFlow(): Promise<void> {
    await runMakeTarget('bootstrap');
    await runLocalCommand('npm', ['run', 'skytest', '--', 'init']);

    printCompletedStep('Bootstrap complete (dependencies, services, db, seed, Playwright).');
    printCompletedStep('SkyTest local workspace initialized (.skytest/skytest.yaml and instance lock).');
}

async function runUpFlow(): Promise<void> {
    await runMakeTarget('dev');
}

async function fileExists(targetPath: string): Promise<boolean> {
    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function processIsAlive(pid: string): Promise<boolean> {
    const result = await tryRunShellStatusCommand(`kill -0 ${pid} >/dev/null 2>&1 && echo alive || true`);
    return Boolean(result?.stdout.trim());
}

async function waitForReady(timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const health = await tryRunShellStatusCommand('curl -fsS http://127.0.0.1:3000/api/health/live >/dev/null && echo ok || true');
        const app = await tryRunShellStatusCommand('ps -Ao args | grep "next dev --hostname" | grep -v grep || true');
        const maintenance = await tryRunShellStatusCommand('ps -Ao args | grep "runner:maintenance" | grep -v grep || true');
        const worker = await tryRunShellStatusCommand('ps -Ao args | grep "browser:worker" | grep -v grep || true');

        if (health?.stdout.trim() && app?.stdout.trim() && maintenance?.stdout.trim() && worker?.stdout.trim()) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`Timed out waiting for local SkyTest readiness after ${timeoutMs}ms.`);
}

async function runUpDetachedFlow(timeoutMs: number): Promise<void> {
    const workspaceRoot = resolveWorkspaceRoot();
    const localDir = path.join(workspaceRoot, '.skytest');
    const pidFile = path.join(localDir, 'local-up.pid');
    const logFile = path.join(localDir, 'local-up.log');

    await mkdir(localDir, { recursive: true });

    if (await fileExists(pidFile)) {
        const existingPid = (await readFile(pidFile, 'utf8')).trim();
        if (existingPid && await processIsAlive(existingPid)) {
            printCompletedStep(`local up already running (pid ${existingPid}).`);
            await waitForReady(timeoutMs);
            printCompletedStep('Local SkyTest is ready.');
            return;
        }
    }

    const startResult = await runShellStatusCommand(`
nohup make dev > "${logFile}" 2>&1 &
echo $!
`);
    const pid = startResult.stdout.trim().split('\n').filter((line) => line.trim()).pop();
    if (!pid) {
        throw new Error('Failed to start detached local SkyTest process.');
    }

    await writeFile(pidFile, `${pid}\n`, 'utf8');
    printCompletedStep(`Started detached local SkyTest (pid ${pid}).`);
    printCompletedStep(`Logs: ${logFile}`);

    await waitForReady(timeoutMs);
    printCompletedStep('Local SkyTest is ready.');
}

async function runDownFlow(): Promise<void> {
    await runMakeTarget('runner-reset');
    await runMakeTarget('services-down');

    printCompletedStep('Local runner state reset.');
    printCompletedStep('Local services stopped.');
}

async function runUpdateFlow(): Promise<void> {
    await runMakeTarget('install');
    await runMakeTarget('services-up');
    await runMakeTarget('db-setup');
    await runMakeTarget('playwright-ensure');
    await runMakeTarget('seed-local-defaults');
    await runLocalCommand('npm', ['run', 'skytest', '--', 'init']);

    printCompletedStep('Dependencies refreshed.');
    printCompletedStep('Services running.');
    printCompletedStep('Database client generated and migrations applied.');
    printCompletedStep('Playwright Chromium verified.');
    printCompletedStep('Local default ownership seed applied.');
    printCompletedStep('SkyTest local workspace verified.');
}

async function runStatusFlow(): Promise<void> {
    const serviceStatus = await tryRunShellStatusCommand('docker compose -f infra/docker/docker-compose.local.yml ps');
    const runningServices = serviceStatus ? collectComposeServiceNames(serviceStatus.stdout) : [];

    const appStatus = await tryRunShellStatusCommand('ps -Ao pid,args | grep "next dev --hostname" | grep -v grep || true');
    const maintenanceStatus = await tryRunShellStatusCommand('ps -Ao pid,args | grep "runner:maintenance" | grep -v grep || true');
    const workerStatus = await tryRunShellStatusCommand('ps -Ao pid,args | grep "browser:worker" | grep -v grep || true');

    console.log('Local SkyTest status');
    if (!serviceStatus) {
        console.log('- Services: unavailable (docker compose check failed)');
    } else {
        console.log(`- Services: ${runningServices.length > 0 ? runningServices.join(', ') : 'none'}`);
    }
    console.log(`- App process: ${appStatus?.stdout.trim() ? 'running' : 'not running'}`);
    console.log(`- Maintenance worker: ${maintenanceStatus?.stdout.trim() ? 'running' : 'not running'}`);
    console.log(`- Browser worker: ${workerStatus?.stdout.trim() ? 'running' : 'not running'}`);
}

export async function runLocalCommandGroup(options: LocalCommandOptions): Promise<void> {
    if (options.action === 'setup') {
        await runSetupFlow();
        return;
    }

    if (options.action === 'up') {
        if (options.detach) {
            await runUpDetachedFlow(options.timeoutMs ?? DEFAULT_DETACH_TIMEOUT_MS);
            return;
        }
        await runUpFlow();
        return;
    }

    if (options.action === 'down') {
        await runDownFlow();
        return;
    }

    if (options.action === 'update') {
        await runUpdateFlow();
        return;
    }

    await runStatusFlow();
}
