import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';

interface RateLimitWindow {
    count: number;
    windowStartMs: number;
}

type RateLimitStoreMode = 'db' | 'memory';

const windows = new Map<string, RateLimitWindow>();
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const RATE_LIMIT_FALLBACK_LOG_DEDUP_MS = 60 * 1000;
const RUNNER_RATE_LIMIT_PREFIX = 'runners-v1-';
const logger = createLogger('runners:rate-limit');

const globalForRateLimit = global as unknown as {
    rateLimitWindowInit?: Promise<void>;
    rateLimitWindowCleanupAtMs?: number;
    rateLimitFallbackLogAtMs?: number;
    inMemoryRateLimitCleanupAtMs?: number;
};

function parseRateLimitStoreMode(name: string, fallback: RateLimitStoreMode): RateLimitStoreMode {
    const rawValue = process.env[name]?.trim().toLowerCase();
    if (rawValue === 'memory' || rawValue === 'db') {
        return rawValue;
    }
    return fallback;
}

function resolveRateLimitStoreMode(key: string): RateLimitStoreMode {
    const defaultMode = parseRateLimitStoreMode('RATE_LIMIT_STORE_MODE', 'db');
    if (!key.startsWith(RUNNER_RATE_LIMIT_PREFIX)) {
        return defaultMode;
    }

    return parseRateLimitStoreMode('RUNNER_RATE_LIMIT_STORE_MODE', 'memory');
}

function cleanupInMemoryWindows(nowMs: number): void {
    const nextCleanupAt = globalForRateLimit.inMemoryRateLimitCleanupAtMs ?? 0;
    if (nowMs < nextCleanupAt) {
        return;
    }

    globalForRateLimit.inMemoryRateLimitCleanupAtMs = nowMs + RATE_LIMIT_CLEANUP_INTERVAL_MS;
    const staleBeforeMs = nowMs - RATE_LIMIT_RETENTION_MS;
    for (const [key, value] of windows.entries()) {
        if (value.windowStartMs < staleBeforeMs) {
            windows.delete(key);
        }
    }
}

function isRateLimitedInMemory(key: string, input: { limit: number; windowMs: number }): boolean {
    const now = Date.now();
    cleanupInMemoryWindows(now);
    const existing = windows.get(key);

    if (!existing || now - existing.windowStartMs >= input.windowMs) {
        windows.set(key, { count: 1, windowStartMs: now });
        return false;
    }

    existing.count += 1;
    return existing.count > input.limit;
}

async function ensureRateLimitWindowStore(): Promise<void> {
    if (globalForRateLimit.rateLimitWindowInit) {
        await globalForRateLimit.rateLimitWindowInit;
        return;
    }

    globalForRateLimit.rateLimitWindowInit = (async () => {
        // Intentionally managed with raw SQL so the open-source deployment can
        // adopt distributed rate limiting without requiring an immediate Prisma migration.
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "RateLimitWindow" (
                "bucketKey" TEXT NOT NULL,
                "windowStartMs" BIGINT NOT NULL,
                "count" INTEGER NOT NULL,
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY ("bucketKey", "windowStartMs")
            );
        `);
        await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "RateLimitWindow_updatedAt_idx"
            ON "RateLimitWindow" ("updatedAt");
        `);
    })();

    try {
        await globalForRateLimit.rateLimitWindowInit;
    } catch (error) {
        globalForRateLimit.rateLimitWindowInit = undefined;
        throw error;
    }
}

async function cleanupOldRateLimitWindows(nowMs: number): Promise<void> {
    const nextCleanupAt = globalForRateLimit.rateLimitWindowCleanupAtMs ?? 0;
    if (nowMs < nextCleanupAt) {
        return;
    }

    globalForRateLimit.rateLimitWindowCleanupAtMs = nowMs + RATE_LIMIT_CLEANUP_INTERVAL_MS;
    const cutoff = new Date(nowMs - RATE_LIMIT_RETENTION_MS);
    await prisma.$executeRaw(
        Prisma.sql`DELETE FROM "RateLimitWindow" WHERE "updatedAt" < ${cutoff}`
    );
}

export async function isRateLimited(key: string, input: { limit: number; windowMs: number }): Promise<boolean> {
    const mode = resolveRateLimitStoreMode(key);
    if (mode === 'memory') {
        return isRateLimitedInMemory(key, input);
    }

    try {
        await ensureRateLimitWindowStore();

        const nowMs = Date.now();
        const windowStartMs = BigInt(Math.floor(nowMs / input.windowMs) * input.windowMs);
        const result = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
            INSERT INTO "RateLimitWindow" ("bucketKey", "windowStartMs", "count", "updatedAt")
            VALUES (${key}, ${windowStartMs}, 1, NOW())
            ON CONFLICT ("bucketKey", "windowStartMs")
            DO UPDATE SET
                "count" = "RateLimitWindow"."count" + 1,
                "updatedAt" = NOW()
            RETURNING "count";
        `);

        void cleanupOldRateLimitWindows(nowMs).catch((cleanupError) => {
            logger.debug('Failed to cleanup stale rate-limit windows', cleanupError);
        });
        const count = result[0]?.count ?? 0;
        return count > input.limit;
    } catch (error) {
        const nowMs = Date.now();
        const lastLogAtMs = globalForRateLimit.rateLimitFallbackLogAtMs ?? 0;
        if (nowMs - lastLogAtMs >= RATE_LIMIT_FALLBACK_LOG_DEDUP_MS) {
            globalForRateLimit.rateLimitFallbackLogAtMs = nowMs;
            logger.warn('Falling back to in-memory rate limiting after DB-backed limiter failure', error);
        }
        return isRateLimitedInMemory(key, input);
    }
}

export function getRateLimitKey(request: Request, prefix: string): string {
    const forwardedFor = request.headers.get('x-forwarded-for') || '';
    const firstForwarded = forwardedFor.split(',')[0]?.trim();
    const realIp = request.headers.get('x-real-ip')?.trim();
    const address = firstForwarded || realIp || 'unknown';
    return `${prefix}:${address}`;
}
