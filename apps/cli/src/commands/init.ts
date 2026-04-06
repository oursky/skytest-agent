import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const RUNTIME_CONFIG_TEMPLATE = `schemaVersion: 1
runtime:
  baseUrl: http://localhost:3000
  browser:
    headless: true
    timeoutMs: 30000
  timeouts:
    stepMs: 30000
    runMs: 600000
catalog:
  include:
    - .skytest/tests/**/*.case.yaml
  exclude: []
`;

function deriveInstanceType(cwd: string): 'root' | 'worktree' {
    return cwd.includes(`${path.sep}.git${path.sep}worktrees${path.sep}`) ? 'worktree' : 'root';
}

function buildInstanceLockYaml(cwd: string): string {
    const instanceId = `inst_${crypto.randomUUID().replace(/-/g, '')}`;
    const instanceType = deriveInstanceType(cwd);
    const instanceName = path.basename(cwd);
    const generatedAt = new Date().toISOString();
    return [
        'schemaVersion: 1',
        `instanceId: ${instanceId}`,
        `instanceType: ${instanceType}`,
        `instanceName: ${instanceName}`,
        `generatedAt: ${generatedAt}`,
        '',
    ].join('\n');
}

async function ensureFile(pathname: string, content: string): Promise<boolean> {
    try {
        await readFile(pathname, 'utf8');
        return false;
    } catch {
        await writeFile(pathname, content, 'utf8');
        return true;
    }
}

function resolveInitRoot(): string {
    const initCwd = process.env.INIT_CWD?.trim();
    if (!initCwd) {
        return process.cwd();
    }
    return path.isAbsolute(initCwd) ? initCwd : path.resolve(process.cwd(), initCwd);
}

export async function runInitCommand(): Promise<void> {
    const cwd = resolveInitRoot();
    const skytestDir = path.join(cwd, '.skytest');
    const testsDir = path.join(skytestDir, 'tests');
    const runtimeConfigPath = path.join(skytestDir, 'skytest.yaml');
    const instanceLockPath = path.join(skytestDir, 'instance.lock.yaml');

    await mkdir(testsDir, { recursive: true });

    const createdRuntimeConfig = await ensureFile(runtimeConfigPath, RUNTIME_CONFIG_TEMPLATE);
    const createdInstanceLock = await ensureFile(instanceLockPath, buildInstanceLockYaml(cwd));

    const messages: string[] = ['Initialized .skytest workspace'];
    messages.push(
        createdRuntimeConfig
            ? `Created ${path.relative(cwd, runtimeConfigPath)}`
            : `Kept existing ${path.relative(cwd, runtimeConfigPath)}`
    );
    messages.push(
        createdInstanceLock
            ? `Created ${path.relative(cwd, instanceLockPath)}`
            : `Kept existing ${path.relative(cwd, instanceLockPath)}`
    );

    console.log(messages.join('\n'));
}
