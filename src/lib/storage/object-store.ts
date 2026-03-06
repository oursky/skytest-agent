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
    getSignedDownloadUrl(input: {
        key: string;
        filename: string;
        contentType?: string;
        inline?: boolean;
    }): Promise<string>;
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

export const objectStore = globalForObjectStore.objectStore ?? createObjectStore();

if (process.env.NODE_ENV !== 'production') {
    globalForObjectStore.objectStore = objectStore;
}
