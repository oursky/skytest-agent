import { TestCaseFile } from '@/types';
import { createTempDirectory, materializeObjectToFile, removeTempDirectory } from '@/lib/storage/object-store-utils';
import path from 'node:path';

export interface MaterializedExecutionFiles {
    allowedTestCaseDir?: string;
    configFiles: Record<string, string>;
    stepFilesById: Record<string, string>;
    cleanup: () => Promise<void>;
}

export async function prepareExecutionFiles(
    files: TestCaseFile[] | undefined,
    resolvedFiles: Record<string, string> | undefined,
    runId: string
): Promise<MaterializedExecutionFiles> {
    const requestedConfigFiles = resolvedFiles ?? {};
    const requestedTestCaseFiles = files ?? [];

    if (requestedTestCaseFiles.length === 0 && Object.keys(requestedConfigFiles).length === 0) {
        return {
            configFiles: {},
            stepFilesById: {},
            cleanup: async () => { },
        };
    }

    const tempRoot = await createTempDirectory(`skytest-run-${runId}-`);
    const testCaseDir = path.join(tempRoot, 'test-case-files');
    const configDir = path.join(tempRoot, 'config-files');
    const stepFilesById: Record<string, string> = {};
    const configFiles: Record<string, string> = {};
    const materializedByObjectKey = new Map<string, string>();

    for (const file of requestedTestCaseFiles) {
        const materializedPath = await materializeObjectToFile({
            key: file.storedName,
            directory: testCaseDir,
            filename: file.filename,
        });
        if (!materializedPath) {
            continue;
        }

        stepFilesById[file.id] = materializedPath;
        materializedByObjectKey.set(file.storedName, materializedPath);
    }

    for (const [referenceName, objectKey] of Object.entries(requestedConfigFiles)) {
        const existingPath = materializedByObjectKey.get(objectKey);
        if (existingPath) {
            configFiles[referenceName] = existingPath;
            continue;
        }

        const fallbackFilename = path.basename(objectKey) || referenceName;
        const materializedPath = await materializeObjectToFile({
            key: objectKey,
            directory: configDir,
            filename: fallbackFilename,
        });

        if (!materializedPath) {
            continue;
        }

        materializedByObjectKey.set(objectKey, materializedPath);
        configFiles[referenceName] = materializedPath;
    }

    return {
        allowedTestCaseDir: Object.keys(stepFilesById).length > 0 ? testCaseDir : undefined,
        configFiles,
        stepFilesById,
        cleanup: async () => {
            await removeTempDirectory(tempRoot);
        },
    };
}
