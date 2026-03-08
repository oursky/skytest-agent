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

export interface ClaimNoCandidateDiagnosis {
    reasonCode:
        | 'RUNNER_CAPABILITY_MISSING'
        | 'NO_QUEUED_RUNS'
        | 'RUNNER_KIND_MISMATCH'
        | 'REQUESTED_DEVICE_UNAVAILABLE'
        | 'RUN_AVAILABLE_BUT_LOCKED';
    queuedAndroidRuns: number;
    queuedCompatibleKindRuns: number;
    explicitRequestedRuns: number;
    explicitRequestedRunsMatchingRunnerDevices: number;
    genericQueuedRuns: number;
    claimableDeviceIds: string[];
}

const EMULATOR_PROFILE_DEVICE_PREFIX = 'emulator-profile:';

function hasAndroidCapability(capabilities: string[]): boolean {
    return capabilities.includes('ANDROID');
}

function createLeaseExpiry(): Date {
    return new Date(Date.now() + appConfig.runner.leaseDurationSeconds * 1000);
}

async function getClaimableDeviceIdsForRunner(runnerId: string): Promise<string[]> {
    const devices = await prisma.runnerDevice.findMany({
        where: { runnerId },
        select: {
            deviceId: true,
            state: true,
        },
    });

    return devices
        .filter((device) => (
            device.deviceId.startsWith(EMULATOR_PROFILE_DEVICE_PREFIX)
                ? (device.state === 'ONLINE' || device.state === 'OFFLINE')
                : device.state === 'ONLINE'
        ))
        .map((device) => device.deviceId);
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

export async function diagnoseNoClaimForRunner(input: {
    runnerId: string;
    teamId: string;
    runnerKind: string;
    capabilities: string[];
}): Promise<ClaimNoCandidateDiagnosis> {
    if (!hasAndroidCapability(input.capabilities)) {
        return {
            reasonCode: 'RUNNER_CAPABILITY_MISSING',
            queuedAndroidRuns: 0,
            queuedCompatibleKindRuns: 0,
            explicitRequestedRuns: 0,
            explicitRequestedRunsMatchingRunnerDevices: 0,
            genericQueuedRuns: 0,
            claimableDeviceIds: [],
        };
    }

    const claimableDeviceIds = await getClaimableDeviceIdsForRunner(input.runnerId);

    const queuedAndroidRuns = await prisma.testRun.count({
        where: {
            status: 'QUEUED',
            assignedRunnerId: null,
            requiredCapability: 'ANDROID',
            testCase: {
                project: {
                    teamId: input.teamId,
                },
            },
        },
    });

    const queuedCompatibleKindRuns = await prisma.testRun.count({
        where: {
            status: 'QUEUED',
            assignedRunnerId: null,
            requiredCapability: 'ANDROID',
            OR: [
                { requiredRunnerKind: null },
                { requiredRunnerKind: input.runnerKind },
            ],
            testCase: {
                project: {
                    teamId: input.teamId,
                },
            },
        },
    });

    const explicitRequestedRuns = await prisma.testRun.count({
        where: {
            status: 'QUEUED',
            assignedRunnerId: null,
            requiredCapability: 'ANDROID',
            OR: [
                { requiredRunnerKind: null },
                { requiredRunnerKind: input.runnerKind },
            ],
            requestedDeviceId: { not: null },
            testCase: {
                project: {
                    teamId: input.teamId,
                },
            },
        },
    });

    const explicitRequestedRunsMatchingRunnerDevices = claimableDeviceIds.length > 0
        ? await prisma.testRun.count({
            where: {
                status: 'QUEUED',
                assignedRunnerId: null,
                requiredCapability: 'ANDROID',
                OR: [
                    { requiredRunnerKind: null },
                    { requiredRunnerKind: input.runnerKind },
                ],
                requestedDeviceId: { in: claimableDeviceIds },
                testCase: {
                    project: {
                        teamId: input.teamId,
                    },
                },
            },
        })
        : 0;

    const genericQueuedRuns = await prisma.testRun.count({
        where: {
            status: 'QUEUED',
            assignedRunnerId: null,
            requiredCapability: 'ANDROID',
            OR: [
                { requiredRunnerKind: null },
                { requiredRunnerKind: input.runnerKind },
            ],
            requestedDeviceId: null,
            testCase: {
                project: {
                    teamId: input.teamId,
                },
            },
        },
    });

    let reasonCode: ClaimNoCandidateDiagnosis['reasonCode'] = 'RUN_AVAILABLE_BUT_LOCKED';
    if (queuedAndroidRuns === 0) {
        reasonCode = 'NO_QUEUED_RUNS';
    } else if (queuedCompatibleKindRuns === 0) {
        reasonCode = 'RUNNER_KIND_MISMATCH';
    } else if (explicitRequestedRuns > 0 && explicitRequestedRunsMatchingRunnerDevices === 0) {
        reasonCode = 'REQUESTED_DEVICE_UNAVAILABLE';
    }

    return {
        reasonCode,
        queuedAndroidRuns,
        queuedCompatibleKindRuns,
        explicitRequestedRuns,
        explicitRequestedRunsMatchingRunnerDevices,
        genericQueuedRuns,
        claimableDeviceIds,
    };
}
