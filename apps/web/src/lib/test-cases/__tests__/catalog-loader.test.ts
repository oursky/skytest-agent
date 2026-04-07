import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadTestCatalog } from '@/lib/test-cases/catalog-loader';

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'skytest-catalog-loader-'));
    tempDirs.push(dir);
    await mkdir(path.join(dir, '.skytest', 'tests'), { recursive: true });
    await writeFile(
        path.join(dir, '.skytest', 'skytest.yaml'),
        [
            'schemaVersion: 1',
            'runtime:',
            '  baseUrl: "http://localhost:3000"',
            '  browser:',
            '    headless: true',
            '    timeoutMs: 30000',
            '  timeouts:',
            '    stepMs: 10000',
            '    runMs: 600000',
            'catalog:',
            '  include:',
            '    - ".skytest/tests/**/*.case.yaml"',
            '',
        ].join('\n')
    );
    return dir;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })));
});

describe('loadTestCatalog', () => {
    it('fails fast when duplicate case IDs exist across files', async () => {
        const projectDir = await createTempProject();
        await writeFile(
            path.join(projectDir, '.skytest', 'tests', 'a.case.yaml'),
            ['id: CASE-A02', 'name: Case A', 'steps: []', ''].join('\n')
        );
        await writeFile(
            path.join(projectDir, '.skytest', 'tests', 'b.case.yaml'),
            ['id: CASE-A02', 'name: Case B', 'steps: []', ''].join('\n')
        );

        await expect(loadTestCatalog(projectDir)).rejects.toThrow('Duplicate test case ID');
    });

    it('returns source path and hash for discovered cases', async () => {
        const projectDir = await createTempProject();
        const casePath = path.join(projectDir, '.skytest', 'tests', 'single.case.yaml');
        await writeFile(casePath, ['id: CASE-A03', 'name: Case C', 'steps: []', ''].join('\n'));

        const catalog = await loadTestCatalog(projectDir);
        const entry = catalog.get('CASE-A03');

        expect(entry).toBeDefined();
        expect(entry?.sourcePath).toBe(casePath);
        expect(entry?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    });
});
