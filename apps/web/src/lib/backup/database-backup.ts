import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/core/logger';
import { getRuntimeRootDir } from '@/lib/runtime/runtime-root';
import { objectStore } from '@/lib/storage/object-store';

const logger = createLogger('backup:database');

const MANIFEST_KEY = `${appConfig.databaseBackup.objectPrefix}manifest.json`;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface BackupManifestEntry {
    key: string;
    createdAt: string;
    bytes: number;
}

interface BackupManifest {
    entries: BackupManifestEntry[];
}

export interface DatabaseBackupResult {
    performed: boolean;
    reason?: 'disabled' | 'not-due' | 'no-database-url' | 'too-large' | 'already-running';
    key?: string;
    bytes?: number;
    prunedKeys: string[];
}

// Cheap gate so the common case — a maintenance tick with no backup due — costs no object-store
// round trip. The manifest remains the source of truth across restarts.
let nextEligibleAtMs = 0;
let inFlight = false;

function isManifest(value: unknown): value is BackupManifest {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const entries = (value as { entries?: unknown }).entries;
    return Array.isArray(entries);
}

async function readManifest(): Promise<BackupManifest> {
    const stored = await objectStore.getObject(MANIFEST_KEY);
    if (!stored) {
        return { entries: [] };
    }

    try {
        const parsed: unknown = JSON.parse(stored.body.toString('utf8'));
        if (!isManifest(parsed)) {
            throw new Error('manifest is not in the expected shape');
        }
        return parsed;
    } catch (error) {
        // A corrupt manifest must not stop backups: start a fresh one. Existing dumps stay in the
        // bucket and simply stop being pruned automatically, which is the safe direction to fail.
        logger.warn('Backup manifest unreadable; starting a new one', {
            error: error instanceof Error ? error.message : String(error),
        });
        return { entries: [] };
    }
}

async function writeManifest(manifest: BackupManifest): Promise<void> {
    await objectStore.putObject({
        key: MANIFEST_KEY,
        body: Buffer.from(JSON.stringify(manifest), 'utf8'),
        contentType: 'application/json',
    });
}

function latestBackupTimeMs(manifest: BackupManifest): number | null {
    let latest: number | null = null;
    for (const entry of manifest.entries) {
        const parsed = Date.parse(entry.createdAt);
        if (!Number.isNaN(parsed) && (latest === null || parsed > latest)) {
            latest = parsed;
        }
    }
    return latest;
}

// pg_dump reads connection details from PG* variables, which keeps the password out of the child's
// argv and therefore out of any process listing.
function pgEnvFromDatabaseUrl(databaseUrl: string): Record<string, string> {
    const parsed = new URL(databaseUrl);
    const env: Record<string, string> = {
        PGHOST: parsed.hostname,
        PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    };
    if (parsed.port) {
        env.PGPORT = parsed.port;
    }
    if (parsed.username) {
        env.PGUSER = decodeURIComponent(parsed.username);
    }
    if (parsed.password) {
        env.PGPASSWORD = decodeURIComponent(parsed.password);
    }
    const sslmode = parsed.searchParams.get('sslmode');
    if (sslmode) {
        env.PGSSLMODE = sslmode;
    }
    return env;
}

async function runPgDump(targetPath: string, databaseUrl: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(
            'pg_dump',
            ['--format=custom', '--no-owner', '--no-acl', '--file', targetPath],
            {
                env: { ...process.env, ...pgEnvFromDatabaseUrl(databaseUrl) },
                stdio: ['ignore', 'ignore', 'pipe'],
            }
        );

        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (error: NodeJS.ErrnoException) => {
            reject(error.code === 'ENOENT'
                ? new Error('pg_dump is not installed in this image')
                : error);
        });
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`pg_dump exited with ${code}: ${stderr.trim().slice(0, 500)}`));
        });
    });
}

async function pruneExpired(manifest: BackupManifest, now: Date): Promise<string[]> {
    const cutoffMs = now.getTime() - appConfig.databaseBackup.retentionDays * DAY_MS;
    const expired = manifest.entries.filter((entry) => {
        const parsed = Date.parse(entry.createdAt);
        return !Number.isNaN(parsed) && parsed < cutoffMs;
    });

    if (expired.length === 0) {
        return [];
    }

    const { failedKeys } = await objectStore.deleteObjects(expired.map((entry) => entry.key));
    const failed = new Set(failedKeys);
    const deleted = expired.filter((entry) => !failed.has(entry.key)).map((entry) => entry.key);

    // Entries whose object could not be deleted stay in the manifest so the next run retries them.
    const deletedSet = new Set(deleted);
    manifest.entries = manifest.entries.filter((entry) => !deletedSet.has(entry.key));

    if (failed.size > 0) {
        logger.warn('Some expired backups could not be deleted; will retry next run', {
            failedKeys: Array.from(failed),
        });
    }

    return deleted;
}

export async function runDatabaseBackupIfDue(now = new Date()): Promise<DatabaseBackupResult> {
    if (!appConfig.databaseBackup.enabled) {
        return { performed: false, reason: 'disabled', prunedKeys: [] };
    }
    if (now.getTime() < nextEligibleAtMs) {
        return { performed: false, reason: 'not-due', prunedKeys: [] };
    }
    if (inFlight) {
        return { performed: false, reason: 'already-running', prunedKeys: [] };
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        return { performed: false, reason: 'no-database-url', prunedKeys: [] };
    }

    const intervalMs = appConfig.databaseBackup.intervalHours * HOUR_MS;
    const manifest = await readManifest();
    const latestMs = latestBackupTimeMs(manifest);
    if (latestMs !== null && now.getTime() - latestMs < intervalMs) {
        nextEligibleAtMs = latestMs + intervalMs;
        return { performed: false, reason: 'not-due', prunedKeys: [] };
    }

    inFlight = true;
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const workingDir = path.join(getRuntimeRootDir(), 'backups');
    const dumpPath = path.join(workingDir, `skytest-${stamp}.dump`);
    const objectKey = `${appConfig.databaseBackup.objectPrefix}skytest-${stamp}.dump`;

    try {
        await mkdir(workingDir, { recursive: true });
        await runPgDump(dumpPath, databaseUrl);

        const { size } = await stat(dumpPath);
        if (size > appConfig.databaseBackup.maxBytes) {
            // The upload path buffers the dump in memory, so an oversized database would OOM the
            // container. Fail loudly instead and let an operator move to a streaming target.
            logger.error('Database dump exceeds the configured maximum; not uploading', {
                bytes: size,
                maxBytes: appConfig.databaseBackup.maxBytes,
            });
            nextEligibleAtMs = now.getTime() + intervalMs;
            return { performed: false, reason: 'too-large', bytes: size, prunedKeys: [] };
        }

        await objectStore.putObject({
            key: objectKey,
            body: await readFile(dumpPath),
            contentType: 'application/octet-stream',
        });

        manifest.entries.push({ key: objectKey, createdAt: now.toISOString(), bytes: size });
        const prunedKeys = await pruneExpired(manifest, now);
        await writeManifest(manifest);

        nextEligibleAtMs = now.getTime() + intervalMs;
        logger.info('Database backup uploaded', {
            key: objectKey,
            bytes: size,
            prunedBackups: prunedKeys.length,
            retentionDays: appConfig.databaseBackup.retentionDays,
        });

        return { performed: true, key: objectKey, bytes: size, prunedKeys };
    } finally {
        inFlight = false;
        await rm(dumpPath, { force: true }).catch(() => undefined);
    }
}
