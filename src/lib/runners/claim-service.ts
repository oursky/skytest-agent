import type { RunnerCapability } from '@skytest/runner-protocol';
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

function getCapabilityFilters(capabilities: string[]) {
    const typedCapabilities = new Set<RunnerCapability>(
        capabilities.filter(
            (item): item is RunnerCapability => item === 'ANDROID' || item === 'BROWSER'
        )
    );

    const hasAndroid = typedCapabilities.has('ANDROID');
    const hasBrowser = typedCapabilities.has('BROWSER');

    const explicitSql = hasAndroid && hasBrowser
        ? Prisma.sql`(tr."requiredCapability" IS NULL OR tr."requiredCapability" IN ('ANDROID', 'BROWSER'))`
        : hasAndroid
            ? Prisma.sql`(tr."requiredCapability" IS NULL OR tr."requiredCapability" = 'ANDROID')`
            : hasBrowser
                ? Prisma.sql`(tr."requiredCapability" IS NULL OR tr."requiredCapability" = 'BROWSER')`
                : Prisma.sql`FALSE`;

    const genericSql = hasAndroid && hasBrowser
        ? Prisma.sql`(COALESCE(tr."requiredCapability", 'BROWSER') = 'BROWSER' OR tr."requiredCapability" = 'ANDROID')`
        : hasAndroid
            ? Prisma.sql`tr."requiredCapability" = 'ANDROID'`
            : hasBrowser
                ? Prisma.sql`COALESCE(tr."requiredCapability", 'BROWSER') = 'BROWSER'`
                : Prisma.sql`FALSE`;

    return { explicitSql, genericSql };
}

function createLeaseExpiry(): Date {
    return new Date(Date.now() + appConfig.runner.leaseDurationSeconds * 1000);
}

async function claimExplicitDeviceRun(input: {
    tx: Prisma.TransactionClient;
    runnerId: string;
    teamId: string;
    runnerKind: string;
    explicitCapabilitySql: Prisma.Sql;
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
              AND ${input.explicitCapabilitySql}
              AND (tr."requiredRunnerKind" IS NULL OR tr."requiredRunnerKind" = ${input.runnerKind})
              AND EXISTS (
                  SELECT 1
                  FROM "RunnerDevice" rd
                  WHERE rd."runnerId" = ${input.runnerId}
                    AND rd."deviceId" = tr."requestedDeviceId"
                    AND rd."state" = 'ONLINE'
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
    genericCapabilitySql: Prisma.Sql;
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
              AND ${input.genericCapabilitySql}
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
    const leaseExpiresAt = createLeaseExpiry();
    const capabilityFilters = getCapabilityFilters(input.capabilities);

    const claimed = await prisma.$transaction(async (tx) => {
        const explicit = await claimExplicitDeviceRun({
            tx,
            runnerId: input.runnerId,
            teamId: input.teamId,
            runnerKind: input.runnerKind,
            explicitCapabilitySql: capabilityFilters.explicitSql,
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
            genericCapabilitySql: capabilityFilters.genericSql,
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
