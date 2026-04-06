import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadRuntimeConfigForCwd } from '@/lib/runtime/runtime-config-loader';

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'runtime-config-loader-'));
    tempRoots.push(dir);
    return dir;
}

async function writeSkytestYaml(root: string, content: string): Promise<void> {
    const skytestDir = path.join(root, '.skytest');
    await mkdir(skytestDir, { recursive: true });
    await writeFile(path.join(skytestDir, 'skytest.yaml'), content, 'utf8');
}

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('loadRuntimeConfigForCwd', () => {
    it('throws when .skytest/skytest.yaml is missing', async () => {
        const root = await createTempRoot();
        await expect(loadRuntimeConfigForCwd(root)).rejects.toThrow('Missing runtime config');
    });

    it('parses valid schemaVersion=1 runtime config', async () => {
        const root = await createTempRoot();
        await writeSkytestYaml(root, [
            'schemaVersion: 1',
            'runtime:',
            '  baseUrl: "http://localhost:3000"',
            '  browser:',
            '    headless: true',
            '    timeoutMs: 60000',
            '  timeouts:',
            '    stepMs: 20000',
            '    runMs: 300000',
            '  env:',
            '    FEATURE_FLAG: "on"',
            'catalog:',
            '  include:',
            '    - ".skytest/tests/**/*.case.yaml"',
        ].join('\n'));

        const cfg = await loadRuntimeConfigForCwd(root);
        expect(cfg.schemaVersion).toBe(1);
        expect(cfg.runtime.baseUrl).toBe('http://localhost:3000');
        expect(cfg.runtime.browser.headless).toBe(true);
        expect(cfg.catalog?.include).toEqual(['.skytest/tests/**/*.case.yaml']);
    });

    it('throws on unsupported schemaVersion', async () => {
        const root = await createTempRoot();
        await writeSkytestYaml(root, [
            'schemaVersion: 2',
            'runtime:',
            '  baseUrl: "http://localhost:3000"',
            '  browser:',
            '    headless: true',
            '    timeoutMs: 60000',
            '  timeouts:',
            '    stepMs: 20000',
            '    runMs: 300000',
        ].join('\n'));

        await expect(loadRuntimeConfigForCwd(root)).rejects.toThrow('Invalid runtime config');
    });
});
