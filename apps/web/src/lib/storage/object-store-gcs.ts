import { Storage, type Bucket, type StorageOptions } from '@google-cloud/storage';

export interface GcsObjectStoreConfig {
    bucket: string;
    projectId: string;
    serviceAccountJsonBase64?: string;
    emulatorHost?: string;
    signedUrlTtlSeconds: number;
}

export interface StoredObject {
    body: Buffer;
    contentLength: number | null;
    contentType: string | null;
}

export class GcsObjectStore {
    private readonly bucket: string;
    private readonly bucketRef: Bucket | null;
    private readonly emulatorHost: string | null;
    private readonly signedUrlTtlSeconds: number;

    constructor(config: GcsObjectStoreConfig) {
        this.bucket = config.bucket;
        this.emulatorHost = normalizeEmulatorHost(config.emulatorHost ?? '');
        this.bucketRef = this.emulatorHost ? null : this.createStorageClient(config).bucket(config.bucket);
        this.signedUrlTtlSeconds = config.signedUrlTtlSeconds;
    }

    async putObject(input: {
        key: string;
        body: Buffer;
        contentType?: string;
    }): Promise<void> {
        if (this.emulatorHost) {
            await this.putObjectViaEmulator(input);
            return;
        }

        await this.getBucketRef().file(input.key).save(input.body, {
            resumable: false,
            contentType: input.contentType,
        });
    }

    async getObject(key: string): Promise<StoredObject | null> {
        if (this.emulatorHost) {
            return this.getObjectViaEmulator(key);
        }

        const file = this.getBucketRef().file(key);

        try {
            const [body] = await file.download();
            const [metadata] = await file.getMetadata();
            const contentLength = Number.parseInt(String(metadata.size ?? ''), 10);

            return {
                body,
                contentLength: Number.isFinite(contentLength) ? contentLength : null,
                contentType: metadata.contentType ?? null,
            };
        } catch (error) {
            if (isMissingObjectError(error)) {
                return null;
            }

            throw error;
        }
    }

    async deleteObject(key: string): Promise<void> {
        if (this.emulatorHost) {
            await this.deleteObjectViaEmulator(key);
            return;
        }

        await this.getBucketRef().file(key).delete({ ignoreNotFound: true });
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

        if (this.emulatorHost) {
            return buildEmulatorDownloadUrl({
                emulatorHost: this.emulatorHost,
                bucket: this.bucket,
                key: input.key,
                responseDisposition,
                responseType: input.contentType,
            });
        }

        const [url] = await this.getBucketRef().file(input.key).getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + this.signedUrlTtlSeconds * 1000,
            responseDisposition,
            responseType: input.contentType,
        });

        return url;
    }

    async checkHealth(): Promise<void> {
        if (this.emulatorHost) {
            const response = await fetch(`${this.emulatorHost}/storage/v1/b/${encodeURIComponent(this.bucket)}`);
            if (response.ok) {
                return;
            }

            if (response.status === 404) {
                throw new Error(`GCS bucket does not exist: ${this.bucket}`);
            }

            throw new Error(`GCS emulator health check failed with status ${response.status}`);
        }

        const [exists] = await this.getBucketRef().exists();
        if (!exists) {
            throw new Error(`GCS bucket does not exist: ${this.bucket}`);
        }
    }

    private getBucketRef(): Bucket {
        if (!this.bucketRef) {
            throw new Error('GCS bucket client is unavailable in emulator mode');
        }

        return this.bucketRef;
    }

    private createStorageClient(config: GcsObjectStoreConfig): Storage {
        const storageOptions: StorageOptions = {
            projectId: config.projectId,
        };

        const serviceAccountJson = config.serviceAccountJsonBase64?.trim();
        if (serviceAccountJson) {
            storageOptions.credentials = parseServiceAccountJson(serviceAccountJson);
        }

        return new Storage(storageOptions);
    }

    private async putObjectViaEmulator(input: {
        key: string;
        body: Buffer;
        contentType?: string;
    }): Promise<void> {
        const uploadUrl = buildEmulatorUploadUrl({
            emulatorHost: this.requireEmulatorHost(),
            bucket: this.bucket,
            key: input.key,
        });

        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: input.contentType ? { 'Content-Type': input.contentType } : undefined,
            body: new Uint8Array(input.body),
        });

        if (!response.ok) {
            throw new Error(`GCS emulator putObject failed with status ${response.status}`);
        }
    }

    private async getObjectViaEmulator(key: string): Promise<StoredObject | null> {
        const downloadUrl = buildEmulatorDownloadUrl({
            emulatorHost: this.requireEmulatorHost(),
            bucket: this.bucket,
            key,
        });
        const response = await fetch(downloadUrl);

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error(`GCS emulator getObject failed with status ${response.status}`);
        }

        const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
        const contentType = response.headers.get('content-type');
        const body = Buffer.from(await response.arrayBuffer());

        return {
            body,
            contentLength: Number.isFinite(contentLength) ? contentLength : null,
            contentType: contentType && contentType.length > 0 ? contentType : null,
        };
    }

    private async deleteObjectViaEmulator(key: string): Promise<void> {
        const metadataUrl = buildEmulatorObjectMetadataUrl({
            emulatorHost: this.requireEmulatorHost(),
            bucket: this.bucket,
            key,
        });

        const response = await fetch(metadataUrl, { method: 'DELETE' });
        if (!response.ok && response.status !== 404) {
            throw new Error(`GCS emulator deleteObject failed with status ${response.status}`);
        }
    }

    private requireEmulatorHost(): string {
        if (!this.emulatorHost) {
            throw new Error('STORAGE_EMULATOR_HOST is not configured');
        }

        return this.emulatorHost;
    }
}

function normalizeEmulatorHost(host: string): string | null {
    const trimmed = host.trim().replace(/\/+$/, '');
    return trimmed.length > 0 ? trimmed : null;
}

function parseServiceAccountJson(serviceAccountJsonBase64: string): Record<string, unknown> {
    try {
        const raw = Buffer.from(serviceAccountJsonBase64, 'base64').toString('utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('service account JSON is invalid');
        }
        return parsed as Record<string, unknown>;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid GCS_SERVICE_ACCOUNT_JSON_BASE64: ${message}`);
    }
}

function buildEmulatorObjectMetadataUrl(input: {
    emulatorHost: string;
    bucket: string;
    key: string;
}): string {
    return `${input.emulatorHost}/storage/v1/b/${encodeURIComponent(input.bucket)}/o/${encodeURIComponent(input.key)}`;
}

function buildEmulatorUploadUrl(input: {
    emulatorHost: string;
    bucket: string;
    key: string;
}): string {
    const query = new URLSearchParams();
    query.set('uploadType', 'media');
    query.set('name', input.key);

    return `${input.emulatorHost}/upload/storage/v1/b/${encodeURIComponent(input.bucket)}/o?${query.toString()}`;
}

function buildEmulatorDownloadUrl(input: {
    emulatorHost: string;
    bucket: string;
    key: string;
    responseDisposition?: string;
    responseType?: string;
}): string {
    const query = new URLSearchParams();
    query.set('alt', 'media');
    if (input.responseDisposition) {
        query.set('response-content-disposition', input.responseDisposition);
    }

    if (input.responseType) {
        query.set('response-content-type', input.responseType);
    }

    return `${buildEmulatorObjectMetadataUrl(input)}?${query.toString()}`;
}

function isMissingObjectError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const candidate = error as { code?: number; message?: string };
    return candidate.code === 404
        || candidate.message?.toLowerCase().includes('no such object') === true
        || candidate.message?.toLowerCase().includes('not found') === true;
}
