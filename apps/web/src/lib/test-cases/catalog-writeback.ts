import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface WriteCatalogCaseFileInput {
    sourcePath: string;
    expectedHash: string | null;
    nextDocument: string;
}

function sha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

async function writeFileAtomic(targetPath: string, content: string): Promise<void> {
    const tempPath = `${targetPath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, targetPath);
}

export async function writeCatalogCaseFile(input: WriteCatalogCaseFileInput): Promise<{ sourceHash: string }> {
    const resolvedSourcePath = path.resolve(input.sourcePath);
    const pathSegments = resolvedSourcePath.split(path.sep).filter(Boolean);
    if (!pathSegments.includes('.skytest')) {
        throw new Error('Source path must be within a .skytest catalog directory');
    }

    const current = await readFile(resolvedSourcePath, 'utf8');
    const currentHash = sha256(current);
    if (input.expectedHash && currentHash !== input.expectedHash) {
        throw new Error('Source conflict: file changed, refresh and retry');
    }

    await writeFileAtomic(resolvedSourcePath, input.nextDocument);
    return { sourceHash: sha256(input.nextDocument) };
}
