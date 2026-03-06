import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { objectStore } from '@/lib/storage/object-store';
import { sanitizeFilename } from '@/lib/security/file-security';

export async function readObjectBuffer(key: string): Promise<{ body: Buffer; contentType: string | null; contentLength: number | null } | null> {
    return objectStore.getObject(key);
}

export async function putObjectBuffer(input: {
    key: string;
    body: Buffer;
    contentType?: string;
}): Promise<void> {
    await objectStore.putObject(input);
}

export async function deleteObjectIfExists(key: string): Promise<void> {
    await objectStore.deleteObject(key);
}

export async function copyObject(input: {
    sourceKey: string;
    targetKey: string;
    contentType?: string;
}): Promise<boolean> {
    const source = await objectStore.getObject(input.sourceKey);
    if (!source) {
        return false;
    }

    await objectStore.putObject({
        key: input.targetKey,
        body: source.body,
        contentType: input.contentType ?? source.contentType ?? undefined,
    });

    return true;
}

export async function createTempDirectory(prefix: string): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function materializeObjectToFile(input: {
    key: string;
    directory: string;
    filename: string;
}): Promise<string | null> {
    const object = await objectStore.getObject(input.key);
    if (!object) {
        return null;
    }

    const outputPath = path.join(input.directory, sanitizeFilename(input.filename));
    await fs.writeFile(outputPath, object.body);
    return outputPath;
}

export async function removeTempDirectory(directory: string): Promise<void> {
    await fs.rm(directory, { recursive: true, force: true });
}
