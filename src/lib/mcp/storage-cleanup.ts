import { createLogger } from '@/lib/core/logger';
import { deleteObjectIfExists } from '@/lib/storage/object-store-utils';

const logger = createLogger('mcp:storage-cleanup');

export interface StorageCleanupResult {
    deletedObjectCount: number;
    failedObjectKeys: string[];
}

export async function deleteObjectKeysBestEffort(objectKeys: string[]): Promise<StorageCleanupResult> {
    if (objectKeys.length === 0) {
        return {
            deletedObjectCount: 0,
            failedObjectKeys: [],
        };
    }

    const failedObjectKeys: string[] = [];
    let deletedObjectCount = 0;

    await Promise.all(objectKeys.map(async (objectKey) => {
        try {
            await deleteObjectIfExists(objectKey);
            deletedObjectCount += 1;
        } catch {
            failedObjectKeys.push(objectKey);
            logger.warn('Failed to delete object from storage', { objectKey });
        }
    }));

    return {
        deletedObjectCount,
        failedObjectKeys,
    };
}
