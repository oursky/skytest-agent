import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireRunnerProcessLock } from '../process-lock';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'runner-lock-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        await rm(dir, { recursive: true, force: true });
    }
});

describe('acquireRunnerProcessLock', () => {
    it('creates lock metadata and releases lock file', async () => {
        const dir = await createTempDir();
        const lockPath = path.join(dir, 'runner.lock');

        const release = await acquireRunnerProcessLock({
            lockPath,
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            runnerLabel: 'Test Runner',
        });

        const raw = await readFile(lockPath, 'utf8');
        const parsed = JSON.parse(raw) as {
            pid?: number;
            startedAt?: string;
            controlPlaneBaseUrl?: string;
            runnerLabel?: string;
        };

        expect(parsed.pid).toBe(process.pid);
        expect(parsed.startedAt).toBeTypeOf('string');
        expect(parsed.controlPlaneBaseUrl).toBe('http://127.0.0.1:3000');
        expect(parsed.runnerLabel).toBe('Test Runner');

        await release();
        await expect(readFile(lockPath, 'utf8')).rejects.toThrow();
    });

    it('replaces stale lock files before acquiring', async () => {
        const dir = await createTempDir();
        const lockPath = path.join(dir, 'runner.lock');

        await writeFile(lockPath, JSON.stringify({ pid: -1 }), 'utf8');

        const release = await acquireRunnerProcessLock({
            lockPath,
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            runnerLabel: 'Replacement Runner',
        });

        const raw = await readFile(lockPath, 'utf8');
        const parsed = JSON.parse(raw) as { pid?: number; runnerLabel?: string };
        expect(parsed.pid).toBe(process.pid);
        expect(parsed.runnerLabel).toBe('Replacement Runner');

        await release();
    });

    it('rejects when lock is held by a live process', async () => {
        const dir = await createTempDir();
        const lockPath = path.join(dir, 'runner.lock');

        await writeFile(lockPath, JSON.stringify({ pid: process.pid }), 'utf8');

        await expect(acquireRunnerProcessLock({
            lockPath,
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            runnerLabel: 'Blocked Runner',
        })).rejects.toThrow(/already running/);
    });
});
