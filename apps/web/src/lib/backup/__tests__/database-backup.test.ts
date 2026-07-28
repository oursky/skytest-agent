import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStore, spawnSpy, fsMocks } = vi.hoisted(() => ({
    mockStore: {
        putObject: vi.fn(),
        getObject: vi.fn(),
        deleteObject: vi.fn(),
        deleteObjects: vi.fn(),
        getSignedDownloadUrl: vi.fn(),
        checkHealth: vi.fn(),
    },
    spawnSpy: vi.fn(),
    fsMocks: {
        mkdir: vi.fn(),
        readFile: vi.fn(),
        rm: vi.fn(),
        stat: vi.fn(),
    },
}));

vi.mock('@/lib/storage/object-store', () => ({ objectStore: mockStore }));
vi.mock('node:child_process', () => ({ spawn: spawnSpy }));
vi.mock('node:fs/promises', () => fsMocks);
vi.mock('@/lib/runtime/runtime-root', () => ({ getRuntimeRootDir: () => '/tmp/skytest-test' }));

process.env.SKYTEST_DB_BACKUP_ENABLED = 'true';
process.env.DATABASE_URL = 'postgresql://user:pw@db.internal:5432/skytest?sslmode=require';

// The module keeps an in-memory "next eligible" gate so a routine maintenance tick costs no
// object-store round trip. Re-import per test so that state never leaks between cases.
let runDatabaseBackupIfDue: (now?: Date) => Promise<{
    performed: boolean;
    reason?: string;
    key?: string;
    bytes?: number;
    prunedKeys: string[];
}>;

function pgDumpSucceeds() {
    spawnSpy.mockImplementation(() => ({
        stderr: { on: vi.fn() },
        on: (event: string, handler: (code: number) => void) => {
            if (event === 'close') {
                setImmediate(() => handler(0));
            }
        },
    }));
}

function manifestWith(entries: Array<{ key: string; createdAt: string; bytes: number }>) {
    mockStore.getObject.mockResolvedValue({ body: Buffer.from(JSON.stringify({ entries }), 'utf8') });
}

function storedManifest(): { entries: Array<{ key: string; createdAt: string }> } {
    const manifestCall = mockStore.putObject.mock.calls.find(
        ([input]) => (input as { key: string }).key.endsWith('manifest.json')
    );
    if (!manifestCall) {
        throw new Error('manifest was not written');
    }
    return JSON.parse(((manifestCall[0] as { body: Buffer }).body).toString('utf8'));
}

describe('runDatabaseBackupIfDue', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        ({ runDatabaseBackupIfDue } = await import('@/lib/backup/database-backup'));
        mockStore.putObject.mockResolvedValue(undefined);
        mockStore.deleteObjects.mockResolvedValue({ failedKeys: [] });
        fsMocks.mkdir.mockResolvedValue(undefined);
        fsMocks.rm.mockResolvedValue(undefined);
        fsMocks.readFile.mockResolvedValue(Buffer.from('dump-bytes'));
        fsMocks.stat.mockResolvedValue({ size: 2048 });
        pgDumpSucceeds();
    });

    it('uploads a dump and records it in the manifest when none exists', async () => {
        mockStore.getObject.mockResolvedValue(null);

        const result = await runDatabaseBackupIfDue(new Date('2026-07-28T00:00:00Z'));

        expect(result.performed).toBe(true);
        expect(result.bytes).toBe(2048);
        expect(result.key).toMatch(/^backups\/skytest-.*\.dump$/);
        expect(storedManifest().entries).toHaveLength(1);
    });

    it('passes credentials to pg_dump via environment, never argv', async () => {
        mockStore.getObject.mockResolvedValue(null);

        await runDatabaseBackupIfDue(new Date('2026-07-28T01:00:00Z'));

        const [command, args, options] = spawnSpy.mock.calls[0] as [
            string,
            string[],
            { env: Record<string, string> },
        ];
        expect(command).toBe('pg_dump');
        expect(args.join(' ')).not.toContain('pw');
        expect(options.env.PGPASSWORD).toBe('pw');
        expect(options.env.PGHOST).toBe('db.internal');
        expect(options.env.PGDATABASE).toBe('skytest');
        expect(options.env.PGSSLMODE).toBe('require');
    });

    it('skips when the most recent backup is inside the interval', async () => {
        manifestWith([
            { key: 'backups/recent.dump', createdAt: '2026-07-28T00:00:00Z', bytes: 10 },
        ]);

        const result = await runDatabaseBackupIfDue(new Date('2026-07-28T03:00:00Z'));

        expect(result.performed).toBe(false);
        expect(result.reason).toBe('not-due');
        expect(spawnSpy).not.toHaveBeenCalled();
    });

    it('deletes backups past the retention window and drops them from the manifest', async () => {
        manifestWith([
            { key: 'backups/ancient.dump', createdAt: '2026-01-01T00:00:00Z', bytes: 10 },
            { key: 'backups/fresh.dump', createdAt: '2026-07-20T00:00:00Z', bytes: 10 },
        ]);

        const result = await runDatabaseBackupIfDue(new Date('2026-07-28T06:00:00Z'));

        expect(result.performed).toBe(true);
        expect(mockStore.deleteObjects).toHaveBeenCalledWith(['backups/ancient.dump']);
        expect(result.prunedKeys).toEqual(['backups/ancient.dump']);
        expect(storedManifest().entries.map((e) => e.key)).not.toContain('backups/ancient.dump');
    });

    it('keeps entries whose objects failed to delete so the next run retries them', async () => {
        manifestWith([
            { key: 'backups/stubborn.dump', createdAt: '2026-01-01T00:00:00Z', bytes: 10 },
        ]);
        mockStore.deleteObjects.mockResolvedValue({ failedKeys: ['backups/stubborn.dump'] });

        const result = await runDatabaseBackupIfDue(new Date('2026-07-28T09:00:00Z'));

        expect(result.prunedKeys).toEqual([]);
        expect(storedManifest().entries.map((e) => e.key)).toContain('backups/stubborn.dump');
    });

    it('refuses to upload a dump larger than the configured maximum', async () => {
        mockStore.getObject.mockResolvedValue(null);
        fsMocks.stat.mockResolvedValue({ size: 900 * 1024 * 1024 });

        const result = await runDatabaseBackupIfDue(new Date('2026-07-28T12:00:00Z'));

        expect(result.performed).toBe(false);
        expect(result.reason).toBe('too-large');
        expect(mockStore.putObject).not.toHaveBeenCalled();
    });

    it('starts a fresh manifest when the stored one is corrupt', async () => {
        mockStore.getObject.mockResolvedValue({ body: Buffer.from('not json', 'utf8') });

        const result = await runDatabaseBackupIfDue(new Date('2026-07-28T15:00:00Z'));

        expect(result.performed).toBe(true);
        expect(storedManifest().entries).toHaveLength(1);
    });

    it('removes the temporary dump even when pg_dump fails', async () => {
        mockStore.getObject.mockResolvedValue(null);
        spawnSpy.mockImplementation(() => ({
            stderr: { on: (_e: string, cb: (c: Buffer) => void) => cb(Buffer.from('boom')) },
            on: (event: string, handler: (code: number) => void) => {
                if (event === 'close') {
                    setImmediate(() => handler(1));
                }
            },
        }));

        await expect(runDatabaseBackupIfDue(new Date('2026-07-28T18:00:00Z'))).rejects.toThrow(/pg_dump exited with 1/);
        expect(fsMocks.rm).toHaveBeenCalled();
    });
});
