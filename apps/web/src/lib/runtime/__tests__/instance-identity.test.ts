import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureRuntimeInstanceIdentity } from '@/lib/runtime/instance-identity';

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'instance-identity-'));
    tempRoots.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ensureRuntimeInstanceIdentity', () => {
    it('creates lockfile when missing', async () => {
        const root = await createTempRoot();
        const identity = await ensureRuntimeInstanceIdentity(root);
        expect(identity.instanceId).toMatch(/^inst_/);
        expect(identity.schemaVersion).toBe(1);
        expect(identity.instanceName).toBe(path.basename(root));
    });

    it('returns same identity for repeated runs in same checkout', async () => {
        const root = await createTempRoot();
        const first = await ensureRuntimeInstanceIdentity(root);
        const second = await ensureRuntimeInstanceIdentity(root);
        expect(first.instanceId).toBe(second.instanceId);
        expect(first.generatedAt).toBe(second.generatedAt);
    });
});
