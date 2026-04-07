import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeCatalogCaseFile } from '@/lib/test-cases/catalog-writeback';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'skytest-catalog-writeback-'));
    tempDirs.push(dir);
    await mkdir(path.join(dir, '.skytest', 'tests'), { recursive: true });
    return dir;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })));
});

describe('writeCatalogCaseFile', () => {
    it('rejects writes for paths outside the .skytest catalog tree', async () => {
        const dir = await createTempDir();
        const filePath = path.join(dir, 'outside.case.yaml');
        await writeFile(filePath, ['id: CASE-C01', 'name: Outside', 'steps: []', ''].join('\n'));

        await expect(
            writeCatalogCaseFile({
                sourcePath: filePath,
                expectedHash: null,
                nextDocument: ['id: CASE-C01', 'name: Updated', 'steps: []', ''].join('\n'),
            })
        ).rejects.toThrow('Source path must be within a .skytest catalog directory');
    });

    it('rejects paths that escape out of .skytest after canonicalization', async () => {
        const dir = await createTempDir();
        const escapedPath = path.join(dir, '.skytest', '..', 'outside.case.yaml');
        await writeFile(path.join(dir, 'outside.case.yaml'), ['id: CASE-C01', 'name: Outside', 'steps: []', ''].join('\n'));

        await expect(
            writeCatalogCaseFile({
                sourcePath: escapedPath,
                expectedHash: null,
                nextDocument: ['id: CASE-C01', 'name: Updated', 'steps: []', ''].join('\n'),
            })
        ).rejects.toThrow('Source path must be within a .skytest catalog directory');
    });

    it('rejects paths under similarly named directories that are not .skytest', async () => {
        const dir = await createTempDir();
        const falseMarkerPath = path.join(dir, '.skytest-backup', 'tests', 'target.case.yaml');
        await mkdir(path.dirname(falseMarkerPath), { recursive: true });
        await writeFile(falseMarkerPath, ['id: CASE-C01', 'name: Outside', 'steps: []', ''].join('\n'));

        await expect(
            writeCatalogCaseFile({
                sourcePath: falseMarkerPath,
                expectedHash: null,
                nextDocument: ['id: CASE-C01', 'name: Updated', 'steps: []', ''].join('\n'),
            })
        ).rejects.toThrow('Source path must be within a .skytest catalog directory');
    });

    it('rejects write when expectedHash mismatches', async () => {
        const dir = await createTempDir();
        const filePath = path.join(dir, '.skytest', 'tests', 'target.case.yaml');
        await writeFile(filePath, ['id: CASE-C02', 'name: Original', 'steps: []', ''].join('\n'));

        await expect(
            writeCatalogCaseFile({
                sourcePath: filePath,
                expectedHash: 'deadbeef',
                nextDocument: ['id: CASE-C02', 'name: Updated', 'steps: []', ''].join('\n'),
            })
        ).rejects.toThrow('Source conflict');
    });

    it('writes atomically and returns updated source hash', async () => {
        const dir = await createTempDir();
        const filePath = path.join(dir, '.skytest', 'tests', 'target.case.yaml');
        const original = ['id: CASE-C03', 'name: Original', 'steps: []', ''].join('\n');
        const updated = ['id: CASE-C03', 'name: Updated', 'steps: []', ''].join('\n');
        await writeFile(filePath, original);

        const first = await writeCatalogCaseFile({
            sourcePath: filePath,
            expectedHash: null,
            nextDocument: original,
        });

        const result = await writeCatalogCaseFile({
            sourcePath: filePath,
            expectedHash: first.sourceHash,
            nextDocument: updated,
        });

        const current = await readFile(filePath, 'utf8');
        expect(current).toBe(updated);
        expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    });
});
