import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    constructorSpy,
    mockStore,
} = vi.hoisted(() => {
    const mockStore = {
        putObject: vi.fn(),
        getObject: vi.fn(),
        deleteObject: vi.fn(),
        deleteObjects: vi.fn(),
        getSignedDownloadUrl: vi.fn(),
        checkHealth: vi.fn(),
    };

    return {
        constructorSpy: vi.fn((...args: unknown[]) => {
            void args;
            return mockStore;
        }),
        mockStore,
    };
});

interface StorageConfigInput {
    bucket?: string;
    endpoint?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle?: boolean;
    signedUrlTtlSeconds?: number;
}

function buildStorageConfig(overrides: StorageConfigInput = {}): Required<StorageConfigInput> {
    return {
        bucket: 'skytest-agent',
        endpoint: 'http://127.0.0.1:9000',
        region: 'us-east-1',
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
        forcePathStyle: true,
        signedUrlTtlSeconds: 900,
        ...overrides,
    };
}

async function loadObjectStoreWithStorageConfig(storage: Required<StorageConfigInput>) {
    vi.resetModules();
    (globalThis as { objectStore?: unknown }).objectStore = undefined;

    vi.doMock('@/config/app', () => ({
        config: {
            storage,
        },
    }));

    vi.doMock('@/lib/storage/object-store-s3', () => ({
        S3ObjectStore: function MockS3ObjectStore(...args: unknown[]) {
            return constructorSpy(args[0]);
        },
    }));

    return import('@/lib/storage/object-store');
}

describe('object-store factory', () => {
    beforeEach(() => {
        constructorSpy.mockReset();
        mockStore.putObject.mockReset();
        mockStore.getObject.mockReset();
        mockStore.deleteObject.mockReset();
        mockStore.deleteObjects.mockReset();
        mockStore.getSignedDownloadUrl.mockReset();
        mockStore.checkHealth.mockReset();
        (globalThis as { objectStore?: unknown }).objectStore = undefined;
    });

    it('creates an S3 object store with validated config and delegates operations', async () => {
        const config = buildStorageConfig();
        mockStore.getObject.mockResolvedValueOnce({
            body: Buffer.from('ok'),
            contentLength: 2,
            contentType: 'text/plain',
        });

        const objectStoreModule = await loadObjectStoreWithStorageConfig(config);

        await objectStoreModule.objectStore.getObject('artifacts/file.txt');

        expect(constructorSpy).toHaveBeenCalledTimes(1);
        expect(constructorSpy).toHaveBeenCalledWith(config);
        expect(mockStore.getObject).toHaveBeenCalledWith('artifacts/file.txt');
    });

    it('fails fast when required S3 variables are missing', async () => {
        const objectStoreModule = await loadObjectStoreWithStorageConfig(buildStorageConfig({
            bucket: '',
            endpoint: '',
            accessKeyId: '',
        }));

        expect(() => objectStoreModule.getObjectStore()).toThrowError(
            'S3 object storage is not fully configured: missing S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID'
        );
    });

    it('reuses the same object store instance in non-production mode', async () => {
        const objectStoreModule = await loadObjectStoreWithStorageConfig(buildStorageConfig());

        const first = objectStoreModule.getObjectStore();
        const second = objectStoreModule.getObjectStore();

        expect(first).toBe(second);
        expect(constructorSpy).toHaveBeenCalledTimes(1);
    });
});
