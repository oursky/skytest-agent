import { config } from '@/config/app';
import { S3ObjectStore, type StoredObject } from '@/lib/storage/object-store-s3';

export interface ObjectStore {
    putObject(input: {
        key: string;
        body: Buffer;
        contentType?: string;
    }): Promise<void>;
    getObject(key: string): Promise<StoredObject | null>;
    deleteObject(key: string): Promise<void>;
    deleteObjects(keys: string[]): Promise<{ failedKeys: string[] }>;
    getSignedDownloadUrl(input: {
        key: string;
        filename: string;
        contentType?: string;
        inline?: boolean;
    }): Promise<string>;
    checkHealth(): Promise<void>;
}

const globalForObjectStore = global as unknown as { objectStore?: ObjectStore };

function createObjectStore(): ObjectStore {
    const { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, signedUrlTtlSeconds } = config.storage;

    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
        throw new Error('S3 object storage is not fully configured');
    }

    return new S3ObjectStore({
        endpoint,
        region,
        bucket,
        accessKeyId,
        secretAccessKey,
        forcePathStyle,
        signedUrlTtlSeconds,
    });
}

export function getObjectStore(): ObjectStore {
    if (globalForObjectStore.objectStore) {
        return globalForObjectStore.objectStore;
    }

    const store = createObjectStore();
    if (process.env.NODE_ENV !== 'production') {
        globalForObjectStore.objectStore = store;
    }

    return store;
}

export const objectStore: ObjectStore = {
    putObject(input) {
        return getObjectStore().putObject(input);
    },
    getObject(key) {
        return getObjectStore().getObject(key);
    },
    deleteObject(key) {
        return getObjectStore().deleteObject(key);
    },
    deleteObjects(keys) {
        return getObjectStore().deleteObjects(keys);
    },
    getSignedDownloadUrl(input) {
        return getObjectStore().getSignedDownloadUrl(input);
    },
    checkHealth() {
        return getObjectStore().checkHealth();
    },
};

export async function checkObjectStoreHealth(): Promise<void> {
    await objectStore.checkHealth();
}
