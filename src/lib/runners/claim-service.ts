import { Prisma } from '@prisma/client';
import { config as appConfig } from '@/config/app';
import { prisma } from '@/lib/core/prisma';

interface ClaimedRunRow {
    id: string;
    testCaseId: string;
    requiredCapability: string | null;
    requestedDeviceId: string | null;
    leaseExpiresAt: Date;
}

const EMULATOR_PROFILE_DEVICE_PREFIX = 'emulator-profile:';

function hasAndroidCapability(capabilities: string[]): boolean {
    return capabilities.includes('ANDROID');
}

function createLeaseExpiry(): Date {
    return new Date(Date.now() + appConfig.runner.leaseDurationSeconds * 1000);
}

async function claimExplicitDeviceRun(input: {
    tx: Prisma.TransactionClient;
    runnerId: string;
    teamId: string;
    runnerKind: string;
    leaseExpiresAt: Date;
}): Promise<ClaimedRunRow | null> {
    const rows = await input.tx.$queryRaw<ClaimedRunRow[]>(Prisma.sql`
        WITH candidate AS (
            SELECT tr.id
            FROM "TestRun" tr
            INNER JOIN "TestCase" tc ON tc.id = tr."testCaseId"
            INNER JOIN "Project" p ON p.id = tc."projectId"
            WHERE tr.status = 'QUEUED'
              AND tr."assignedRunnerId" IS NULL
              AND tr."requestedDeviceId" IS NOT NULL
              AND p."teamId" = ${input.teamId}
              AND tr."requiredCapability" = 'ANDROID'
              AND (tr."requiredRunnerKind" IS NULL OR tr."requiredRunnerKind" = ${input.runnerKind})
              AND EXISTS (
                  SELECT 1
                  FROM "RunnerDevice" rd
                  WHERE rd."runnerId" = ${input.runnerId}
                    AND rd."deviceId" = tr."requestedDeviceId"
                    AND (
                        (tr."requestedDeviceId" LIKE ${`${EMULATOR_PROFILE_DEVICE_PREFIX}%`} AND rd."state" IN ('ONLINE', 'OFFLINE'))
                        OR (tr."requestedDeviceId" NOT LIKE ${`${EMULATOR_PROFILE_DEVICE_PREFIX}%`} AND rd."state" = 'ONLINE')
                    )
              )
            ORDER BY tr."createdAt" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE "TestRun" tr
        SET
            "assignedRunnerId" = ${input.runnerId},
            "leaseExpiresAt" = ${input.leaseExpiresAt},
            "status" = 'PREPARING',
            "startedAt" = COALESCE(tr."startedAt", NOW())
        FROM candidate
        WHERE tr.id = candidate.id
        RETURNING tr.id, tr."testCaseId", tr."requiredCapability", tr."requestedDeviceId", tr."leaseExpiresAt";
    `);

    return rows[0] ?? null;
}

async function claimGenericRun(input: {
    tx: Prisma.TransactionClient;
    runnerId: string;
    teamId: string;
    runnerKind: string;
    leaseExpiresAt: Date;
}): Promise<ClaimedRunRow | null> {
    const rows = await input.tx.$queryRaw<ClaimedRunRow[]>(Prisma.sql`
        WITH candidate AS (
            SELECT tr.id
            FROM "TestRun" tr
            INNER JOIN "TestCase" tc ON tc.id = tr."testCaseId"
            INNER JOIN "Project" p ON p.id = tc."projectId"
            WHERE tr.status = 'QUEUED'
              AND tr."assignedRunnerId" IS NULL
              AND tr."requestedDeviceId" IS NULL
              AND p."teamId" = ${input.teamId}
              AND tr."requiredCapability" = 'ANDROID'
              AND (tr."requiredRunnerKind" IS NULL OR tr."requiredRunnerKind" = ${input.runnerKind})
            ORDER BY tr."createdAt" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE "TestRun" tr
        SET
            "assignedRunnerId" = ${input.runnerId},
            "leaseExpiresAt" = ${input.leaseExpiresAt},
            "status" = 'PREPARING',
            "startedAt" = COALESCE(tr."startedAt", NOW())
        FROM candidate
        WHERE tr.id = candidate.id
        RETURNING tr.id, tr."testCaseId", tr."requiredCapability", tr."requestedDeviceId", tr."leaseExpiresAt";
    `);

    return rows[0] ?? null;
}

export async function claimNextRunForRunner(input: {
    runnerId: string;
    teamId: string;
    runnerKind: string;
    capabilities: string[];
}) {
    if (!hasAndroidCapability(input.capabilities)) {
        return null;
    }

    const leaseExpiresAt = createLeaseExpiry();

    const claimed = await prisma.$transaction(async (tx) => {
        const explicit = await claimExplicitDeviceRun({
            tx,
            runnerId: input.runnerId,
            teamId: input.teamId,
            runnerKind: input.runnerKind,
            leaseExpiresAt,
        });
        if (explicit) {
            return explicit;
        }

        return claimGenericRun({
            tx,
            runnerId: input.runnerId,
            teamId: input.teamId,
            runnerKind: input.runnerKind,
            leaseExpiresAt,
        });
    });

    if (!claimed) {
        return null;
    }

    return {
        runId: claimed.id,
        testCaseId: claimed.testCaseId,
        requiredCapability: claimed.requiredCapability,
        requestedDeviceId: claimed.requestedDeviceId,
        leaseExpiresAt: claimed.leaseExpiresAt,
    };
}
