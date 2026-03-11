import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3ObjectStoreConfig {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    signedUrlTtlSeconds: number;
}

export interface StoredObject {
    body: Buffer;
    contentLength: number | null;
    contentType: string | null;
}

export class S3ObjectStore {
    private static readonly MAX_DELETE_OBJECTS_BATCH_SIZE = 1000;
    private readonly client: S3Client;
    private readonly bucket: string;
    private readonly signedUrlTtlSeconds: number;

    constructor(private readonly config: S3ObjectStoreConfig) {
        this.bucket = config.bucket;
        this.signedUrlTtlSeconds = config.signedUrlTtlSeconds;
        this.client = new S3Client({
            endpoint: config.endpoint,
            region: config.region,
            forcePathStyle: config.forcePathStyle,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        });
    }

    async putObject(input: {
        key: string;
        body: Buffer;
        contentType?: string;
    }): Promise<void> {
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: input.key,
            Body: input.body,
            ContentType: input.contentType,
        }));
    }

    async getObject(key: string): Promise<StoredObject | null> {
        try {
            const response = await this.client.send(new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
            }));

            if (!response.Body) {
                return null;
            }

            const bytes = await response.Body.transformToByteArray();
            return {
                body: Buffer.from(bytes),
                contentLength: typeof response.ContentLength === 'number' ? response.ContentLength : null,
                contentType: response.ContentType ?? null,
            };
        } catch (error) {
            if (isMissingObjectError(error)) {
                return null;
            }
            throw error;
        }
    }

    async deleteObject(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }));
    }

    async deleteObjects(keys: string[]): Promise<{ failedKeys: string[] }> {
        if (keys.length === 0) {
            return { failedKeys: [] };
        }

        const failedKeys: string[] = [];

        for (let offset = 0; offset < keys.length; offset += S3ObjectStore.MAX_DELETE_OBJECTS_BATCH_SIZE) {
            const chunk = keys.slice(offset, offset + S3ObjectStore.MAX_DELETE_OBJECTS_BATCH_SIZE);
            const response = await this.client.send(new DeleteObjectsCommand({
                Bucket: this.bucket,
                Delete: {
                    Objects: chunk.map((key) => ({ Key: key })),
                    Quiet: true,
                },
            }));

            const erroredKeys = response.Errors
                ?.map((entry) => entry.Key)
                .filter((key): key is string => typeof key === 'string')
                ?? [];
            failedKeys.push(...erroredKeys);
        }

        return { failedKeys };
    }

    async getSignedDownloadUrl(input: {
        key: string;
        filename: string;
        contentType?: string;
        inline?: boolean;
    }): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: input.key,
            ResponseContentDisposition: `${input.inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(input.filename)}"`,
            ResponseContentType: input.contentType,
        });

        return getSignedUrl(this.client, command, {
            expiresIn: this.signedUrlTtlSeconds,
        });
    }

    async checkHealth(): Promise<void> {
        await this.client.send(new HeadBucketCommand({
            Bucket: this.bucket,
        }));
    }
}

function isMissingObjectError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const candidate = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    return candidate.name === 'NoSuchKey'
        || candidate.Code === 'NoSuchKey'
        || candidate.$metadata?.httpStatusCode === 404;
}
