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
    it('collects duplicate ID errors and keeps valid catalog entries', async () => {
        const projectDir = await createTempProject();
        await writeFile(
            path.join(projectDir, '.skytest', 'tests', 'a.case.yaml'),
            ['id: CASE-C02', 'name: Case A', 'steps: []', ''].join('\n')
        );
        await writeFile(
            path.join(projectDir, '.skytest', 'tests', 'b.case.yaml'),
            ['id: CASE-C02', 'name: Case B', 'steps: []', ''].join('\n')
        );

        const { catalog, errors } = await loadTestCatalog(projectDir);
        expect(catalog.size).toBe(1);
        expect(errors).toEqual([expect.stringContaining('Duplicate test case ID')]);
    });

    it('collects malformed yaml errors and keeps valid catalog entries', async () => {
        const projectDir = await createTempProject();
        await writeFile(
            path.join(projectDir, '.skytest', 'tests', 'valid.case.yaml'),
            ['id: CASE-C03', 'name: Valid', 'steps: []', ''].join('\n')
        );
        await writeFile(
            path.join(projectDir, '.skytest', 'tests', 'invalid.case.yaml'),
            'id: CASE-C04\nname: Invalid\nsteps: [\n'
        );

        const { catalog, errors } = await loadTestCatalog(projectDir);
        expect(catalog.size).toBe(1);
        expect(catalog.has('CASE-C03')).toBe(true);
        expect(errors.length).toBe(1);
    });

    it('returns source path and hash for discovered cases', async () => {
        const projectDir = await createTempProject();
        const casePath = path.join(projectDir, '.skytest', 'tests', 'single.case.yaml');
        await writeFile(casePath, ['id: CASE-C03', 'name: Case C', 'steps: []', ''].join('\n'));

        const { catalog, errors } = await loadTestCatalog(projectDir);
        const entry = catalog.get('CASE-C03');

        expect(entry).toBeDefined();
        expect(entry?.sourcePath).toBe(casePath);
        expect(entry?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
        expect(errors).toEqual([]);
    });
});
