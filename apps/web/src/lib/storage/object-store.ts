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
    const {
        bucket,
        endpoint,
        region,
        accessKeyId,
        secretAccessKey,
        forcePathStyle,
        signedUrlTtlSeconds,
    } = config.storage;

    const missingFields: string[] = [];
    if (!bucket) {
        missingFields.push('S3_BUCKET');
    }
    if (!endpoint) {
        missingFields.push('S3_ENDPOINT');
    }
    if (!region) {
        missingFields.push('S3_REGION');
    }
    if (!accessKeyId) {
        missingFields.push('S3_ACCESS_KEY_ID');
    }
    if (!secretAccessKey) {
        missingFields.push('S3_SECRET_ACCESS_KEY');
    }

    if (missingFields.length > 0) {
        throw new Error(`S3 object storage is not fully configured: missing ${missingFields.join(', ')}`);
    }

    return new S3ObjectStore({
        bucket,
        endpoint,
        region,
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
