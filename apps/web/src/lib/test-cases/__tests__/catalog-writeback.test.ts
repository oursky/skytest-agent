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
    it('rejects write when expectedHash mismatches', async () => {
        const dir = await createTempDir();
        const filePath = path.join(dir, '.skytest', 'tests', 'target.case.yaml');
        await writeFile(filePath, ['id: HAN-C02', 'name: Original', 'steps: []', ''].join('\n'));

        await expect(
            writeCatalogCaseFile({
                sourcePath: filePath,
                expectedHash: 'deadbeef',
                nextDocument: ['id: HAN-C02', 'name: Updated', 'steps: []', ''].join('\n'),
            })
        ).rejects.toThrow('Source conflict');
    });

    it('writes atomically and returns updated source hash', async () => {
        const dir = await createTempDir();
        const filePath = path.join(dir, '.skytest', 'tests', 'target.case.yaml');
        const original = ['id: HAN-C03', 'name: Original', 'steps: []', ''].join('\n');
        const updated = ['id: HAN-C03', 'name: Updated', 'steps: []', ''].join('\n');
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
