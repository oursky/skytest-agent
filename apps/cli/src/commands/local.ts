import { execFile } from 'node:child_process';

interface LocalCommandOptions {
    action: 'setup' | 'up' | 'down' | 'status' | 'update';
}

interface CommandResult {
    stdout: string;
}

async function runLocalCommand(command: string, args: string[]): Promise<CommandResult> {
    return await new Promise<CommandResult>((resolve, reject) => {
        execFile(command, args, {
            cwd: process.cwd(),
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
