import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInitCommand } from './init';

const originalInitCwd = process.env.INIT_CWD;

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await stat(targetPath);
        return true;
    } catch {
        return false;
    }
}

afterEach(() => {
    if (typeof originalInitCwd === 'undefined') {
        delete process.env.INIT_CWD;
        return;
    }
    process.env.INIT_CWD = originalInitCwd;
});

describe('runInitCommand', () => {
    it('uses INIT_CWD as the init target when present', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skytest-cli-init-target-'));
        const tempWorkDir = await mkdtemp(path.join(os.tmpdir(), 'skytest-cli-init-cwd-'));
        process.env.INIT_CWD = tempRoot;

        const previousCwd = process.cwd();
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        process.chdir(tempWorkDir);

        try {
            await runInitCommand();

            expect(await pathExists(path.join(tempRoot, '.skytest', 'skytest.yaml'))).toBe(true);
            expect(await pathExists(path.join(tempRoot, '.skytest', 'instance.lock.yaml'))).toBe(true);
            expect(await pathExists(path.join(tempWorkDir, '.skytest', 'skytest.yaml'))).toBe(false);
        } finally {
            process.chdir(previousCwd);
            logSpy.mockRestore();
            await rm(tempRoot, { recursive: true, force: true });
            await rm(tempWorkDir, { recursive: true, force: true });
        }
    });

    it('keeps existing files on repeated runs', async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skytest-cli-init-repeat-'));
        process.env.INIT_CWD = tempRoot;
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        try {
            await runInitCommand();
            const firstRuntimeConfig = await readFile(path.join(tempRoot, '.skytest', 'skytest.yaml'), 'utf8');
            const firstInstanceLock = await readFile(path.join(tempRoot, '.skytest', 'instance.lock.yaml'), 'utf8');

            await runInitCommand();
            const secondRuntimeConfig = await readFile(path.join(tempRoot, '.skytest', 'skytest.yaml'), 'utf8');
            const secondInstanceLock = await readFile(path.join(tempRoot, '.skytest', 'instance.lock.yaml'), 'utf8');

            expect(secondRuntimeConfig).toBe(firstRuntimeConfig);
            expect(secondInstanceLock).toBe(firstInstanceLock);
        } finally {
            logSpy.mockRestore();
            await rm(tempRoot, { recursive: true, force: true });
        }
    });
});
