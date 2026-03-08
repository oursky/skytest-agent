import { Prisma } from '@prisma/client';
import { config as appConfig } from '@/config/app';
import { prisma } from '@/lib/core/prisma';
import {
    BROWSER_EXECUTION_CAPABILITY,
    BROWSER_EXECUTION_RUNNER_KIND,
} from '@/lib/runners/constants';

interface ClaimedBrowserRunRow {
    id: string;
    leaseExpiresAt: Date;
}

function createLeaseExpiry(now = new Date()): Date {
    return new Date(now.getTime() + appConfig.runner.leaseDurationSeconds * 1000);
}

export async function claimNextBrowserRun(input: { runnerId: string }) {
    const leaseExpiresAt = createLeaseExpiry();
    const rows = await prisma.$queryRaw<ClaimedBrowserRunRow[]>(Prisma.sql`
        WITH candidate AS (
            SELECT tr.id
            FROM "TestRun" tr
            WHERE tr.status = 'QUEUED'
              AND tr."deletedAt" IS NULL
              AND tr."assignedRunnerId" IS NULL
              AND tr."requiredCapability" = ${BROWSER_EXECUTION_CAPABILITY}
              AND (tr."requiredRunnerKind" IS NULL OR tr."requiredRunnerKind" = ${BROWSER_EXECUTION_RUNNER_KIND})
            ORDER BY tr."createdAt" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE "TestRun" tr
        SET
            "assignedRunnerId" = ${input.runnerId},
            "leaseExpiresAt" = ${leaseExpiresAt},
            "status" = 'PREPARING',
            "startedAt" = COALESCE(tr."startedAt", NOW())
        FROM candidate
        WHERE tr.id = candidate.id
        RETURNING tr.id, tr."leaseExpiresAt";
    `);

    const claimed = rows[0];
    if (!claimed) {
        return null;
    }

    return {
        runId: claimed.id,
        leaseExpiresAt: claimed.leaseExpiresAt,
    };
}

export async function renewBrowserRunLease(input: { runId: string; runnerId: string }): Promise<Date | null> {
    const now = new Date();
    const leaseExpiresAt = createLeaseExpiry(now);
    const result = await prisma.testRun.updateMany({
        where: {
            id: input.runId,
            assignedRunnerId: input.runnerId,
            status: {
                in: ['PREPARING', 'RUNNING'],
            },
        },
        data: {
            leaseExpiresAt,
            lastEventAt: now,
        },
    });

    return result.count === 1 ? leaseExpiresAt : null;
}
