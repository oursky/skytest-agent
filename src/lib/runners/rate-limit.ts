import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';

interface RateLimitWindow {
    count: number;
    windowStartMs: number;
}

const windows = new Map<string, RateLimitWindow>();
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const globalForRateLimit = global as unknown as {
    rateLimitWindowInit?: Promise<void>;
    rateLimitWindowCleanupAtMs?: number;
};

function isRateLimitedInMemory(key: string, input: { limit: number; windowMs: number }): boolean {
    const now = Date.now();
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

        void cleanupOldRateLimitWindows(nowMs).catch(() => {});
        const count = result[0]?.count ?? 0;
        return count > input.limit;
    } catch {
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
