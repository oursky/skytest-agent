import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    PutObjectCommand,
    S3Client,
    S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StoredObject {
    body: Buffer;
    contentLength: number | null;
    contentType: string | null;
}

export interface S3ObjectStoreConfig {
    bucket: string;
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    signedUrlTtlSeconds: number;
}

export class S3ObjectStore {
    private readonly bucket: string;
    private readonly client: S3Client;
    private readonly signedUrlTtlSeconds: number;

    constructor(config: S3ObjectStoreConfig) {
        this.bucket = config.bucket;
        this.signedUrlTtlSeconds = config.signedUrlTtlSeconds;

        this.client = new S3Client({
            region: config.region,
            endpoint: config.endpoint,
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

            const body = await toBuffer(response.Body);
            const contentLength = typeof response.ContentLength === 'number' ? response.ContentLength : null;
            const contentType = typeof response.ContentType === 'string' ? response.ContentType : null;

            return {
                body,
                contentLength,
                contentType,
            };
        } catch (error) {
            if (isMissingObjectError(error)) {
                return null;
            }
            throw error;
        }
    }

    async deleteObject(key: string): Promise<void> {
        try {
            await this.client.send(new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: key,
            }));
        } catch (error) {
            if (isMissingObjectError(error)) {
                return;
            }
            throw error;
        }
    }

    async deleteObjects(keys: string[]): Promise<{ failedKeys: string[] }> {
        if (keys.length === 0) {
            return { failedKeys: [] };
        }

        const failedKeys: string[] = [];

        for (const key of keys) {
            try {
                await this.deleteObject(key);
            } catch {
                failedKeys.push(key);
            }
        }

        return { failedKeys };
    }

    async getSignedDownloadUrl(input: {
        key: string;
        filename: string;
        contentType?: string;
        inline?: boolean;
    }): Promise<string> {
        const responseDisposition = `${input.inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(input.filename)}"`;
        return getSignedUrl(this.client, new GetObjectCommand({
            Bucket: this.bucket,
            Key: input.key,
            ResponseContentDisposition: responseDisposition,
            ResponseContentType: input.contentType,
        }), {
            expiresIn: this.signedUrlTtlSeconds,
        });
    }

    async checkHealth(): Promise<void> {
        await this.client.send(new HeadBucketCommand({
            Bucket: this.bucket,
        }));
    }
}

async function toBuffer(stream: unknown): Promise<Buffer> {
    if (stream && typeof (stream as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
        const bytes = await (stream as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
        return Buffer.from(bytes);
    }

    if (stream && Symbol.asyncIterator in (stream as object)) {
        const chunks: Buffer[] = [];
        for await (const chunk of stream as AsyncIterable<Uint8Array | Buffer | string>) {
            if (typeof chunk === 'string') {
                chunks.push(Buffer.from(chunk));
            } else {
                chunks.push(Buffer.from(chunk));
            }
        }
        return Buffer.concat(chunks);
    }

    throw new Error('Unsupported S3 object body stream type');
}

function isMissingObjectError(error: unknown): boolean {
    if (error instanceof S3ServiceException) {
        return error.$metadata.httpStatusCode === 404 || error.name === 'NoSuchKey' || error.name === 'NotFound';
    }

    if (!error || typeof error !== 'object') {
        return false;
    }

    const candidate = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    if (candidate.$metadata?.httpStatusCode === 404) {
        return true;
    }

    const name = candidate.name?.toLowerCase();
    const message = candidate.message?.toLowerCase();
    return name === 'nosuchkey'
        || name === 'notfound'
        || message?.includes('no such key') === true
        || message?.includes('not found') === true;
}
