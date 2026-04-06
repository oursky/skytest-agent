import crypto from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import type { SkytestRuntimeInstanceIdentity, RuntimeInstanceType } from '@/types';

const LOCKFILE_NAME = 'instance.lock.yaml';

function getInstanceType(cwd: string): RuntimeInstanceType {
    return cwd.includes(`${path.sep}.git${path.sep}worktrees${path.sep}`) ? 'worktree' : 'root';
}

function formatInstanceIdentity(identity: SkytestRuntimeInstanceIdentity): string {
    return [
        `schemaVersion: ${identity.schemaVersion}`,
        `instanceId: "${identity.instanceId}"`,
        `instanceType: "${identity.instanceType}"`,
        `instanceName: "${identity.instanceName.replace(/"/g, '\\"')}"`,
        `generatedAt: "${identity.generatedAt}"`,
        '',
    ].join('\n');
}

function parseInstanceIdentity(content: string): SkytestRuntimeInstanceIdentity | null {
    const raw = parseYaml(content);
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }

    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== 1) {
        return null;
    }

    const instanceId = typeof record.instanceId === 'string' ? record.instanceId : '';
    const instanceType = record.instanceType === 'worktree' ? 'worktree' : record.instanceType === 'root' ? 'root' : null;
    const instanceName = typeof record.instanceName === 'string' ? record.instanceName : '';
    const generatedAt = typeof record.generatedAt === 'string' ? record.generatedAt : '';

    if (!instanceId || !instanceType || !instanceName || !generatedAt) {
        return null;
    }

    return {
        schemaVersion: 1,
        instanceId,
        instanceType,
        instanceName,
        generatedAt,
    };
}

async function readLockfile(lockfilePath: string): Promise<SkytestRuntimeInstanceIdentity | null> {
    const raw = await readFile(lockfilePath, 'utf8').catch(() => null);
    if (!raw) {
        return null;
    }
    return parseInstanceIdentity(raw);
}

async function writeLockfileAtomic(
    lockfilePath: string,
    identity: SkytestRuntimeInstanceIdentity
): Promise<void> {
    const tempPath = `${lockfilePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(tempPath, formatInstanceIdentity(identity), 'utf8');
    await rename(tempPath, lockfilePath);
}

export async function ensureRuntimeInstanceIdentity(cwd: string): Promise<SkytestRuntimeInstanceIdentity> {
    const skytestDir = path.join(cwd, '.skytest');
    const lockfilePath = path.join(skytestDir, LOCKFILE_NAME);

    const existing = await readLockfile(lockfilePath);
    if (existing) {
        return existing;
    }

    await mkdir(skytestDir, { recursive: true });

    const nextIdentity: SkytestRuntimeInstanceIdentity = {
        schemaVersion: 1,
        instanceId: `inst_${crypto.randomUUID().replace(/-/g, '')}`,
        instanceType: getInstanceType(cwd),
        instanceName: path.basename(cwd),
        generatedAt: new Date().toISOString(),
    };

    await writeLockfileAtomic(lockfilePath, nextIdentity);
    return nextIdentity;
}
