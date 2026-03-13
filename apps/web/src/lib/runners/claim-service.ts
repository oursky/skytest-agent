import { Prisma } from '@prisma/client';
import { config as appConfig } from '@/config/app';
import { prisma } from '@/lib/core/prisma';
import {
    ACTIVE_LOCKED_RUN_STATUSES,
    CONNECTED_DEVICE_RESOURCE_PREFIX,
    EMULATOR_PROFILE_DEVICE_PREFIX,
} from '@/lib/runners/android-resource-lock';
import { TEST_STATUS } from '@/types';

interface ClaimedRunRow {
    id: string;
    testCaseId: string;
    requiredCapability: string | null;
    requestedDeviceId: string | null;
    requestedRunnerId: string | null;
    leaseExpiresAt: Date;
}

interface ExplicitCandidateRow {
    id: string;
    testCaseId: string;
    requiredCapability: string | null;
    requestedDeviceId: string;
    requestedRunnerId: string | null;
    hostFingerprint: string;
    resourceKey: string;
    resourceType: string;
}

export interface ClaimNoCandidateDiagnosis {
    reasonCode:
        | 'RUNNER_CAPABILITY_MISSING'
        | 'NO_QUEUED_RUNS'
        | 'RUNNER_KIND_MISMATCH'
        | 'REQUESTED_DEVICE_UNAVAILABLE'
        | 'RUN_BLOCKED_BY_HOST_RESOURCE_LOCK'
        | 'RUN_AVAILABLE_BUT_LOCKED';
    queuedAndroidRuns: number;
    queuedCompatibleKindRuns: number;
    explicitRequestedRuns: number;
    explicitRequestedRunsMatchingRunnerDevices: number;
    explicitRequestedRunsBlockedByHostLocks: number;
    blockedHostResourceKeys: string[];
    genericQueuedRuns: number;
    claimableDeviceIds: string[];
}

const ACTIVE_RUN_STATUSES = ACTIVE_LOCKED_RUN_STATUSES;

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
    const candidates = await input.tx.$queryRaw<ExplicitCandidateRow[]>(Prisma.sql`
        WITH runner_context AS (
            SELECT r.id, r."hostFingerprint"
            FROM "Runner" r
            WHERE r.id = ${input.runnerId}
              AND r.status = 'ONLINE'
        ),
        candidate AS (
            SELECT
                tr.id,
                tr."testCaseId",
                tr."requiredCapability",
                tr."requestedDeviceId",
                tr."requestedRunnerId",
                rc."hostFingerprint" AS "hostFingerprint",
                CASE
                    WHEN tr."requestedDeviceId" LIKE ${`${EMULATOR_PROFILE_DEVICE_PREFIX}%`}
                        THEN tr."requestedDeviceId"
                    ELSE ${CONNECTED_DEVICE_RESOURCE_PREFIX} || tr."requestedDeviceId"
                END AS "resourceKey",
                CASE
                    WHEN tr."requestedDeviceId" LIKE ${`${EMULATOR_PROFILE_DEVICE_PREFIX}%`}
                        THEN 'EMULATOR_PROFILE'
                    ELSE 'CONNECTED_DEVICE'
                END AS "resourceType"
            FROM "TestRun" tr
            INNER JOIN "TestCase" tc ON tc.id = tr."testCaseId"
            INNER JOIN "Project" p ON p.id = tc."projectId"
            INNER JOIN runner_context rc ON TRUE
            WHERE tr.status = ${TEST_STATUS.QUEUED}
              AND tr."deletedAt" IS NULL
              AND tr."assignedRunnerId" IS NULL
              AND tr."requestedDeviceId" IS NOT NULL
              AND p."teamId" = ${input.teamId}
              AND tr."requiredCapability" = 'ANDROID'
              AND (tr."requiredRunnerKind" IS NULL OR tr."requiredRunnerKind" = ${input.runnerKind})
              AND (tr."requestedRunnerId" IS NULL OR tr."requestedRunnerId" = ${input.runnerId})
              AND (
                  SELECT COUNT(*)
                  FROM "TestRun" activeTr
                  WHERE activeTr."deletedAt" IS NULL
                    AND activeTr.status IN (${Prisma.join(ACTIVE_RUN_STATUSES)})
              ) < ${appConfig.runner.maxConcurrentRuns}
              AND (
                  SELECT COUNT(*)
                  FROM "TestRun" activeTr
                  INNER JOIN "TestCase" activeTc ON activeTc.id = activeTr."testCaseId"
                  WHERE activeTr."deletedAt" IS NULL
                    AND activeTr.status IN (${Prisma.join(ACTIVE_RUN_STATUSES)})
                    AND activeTc."projectId" = tc."projectId"
              ) < p."maxConcurrentRuns"
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
              AND NOT EXISTS (
                  SELECT 1
                  FROM "AndroidResourceLock" arl
                  WHERE arl."hostFingerprint" = rc."hostFingerprint"
                    AND arl."resourceKey" = (
                        CASE
                            WHEN tr."requestedDeviceId" LIKE ${`${EMULATOR_PROFILE_DEVICE_PREFIX}%`}
                                THEN tr."requestedDeviceId"
                            ELSE ${CONNECTED_DEVICE_RESOURCE_PREFIX} || tr."requestedDeviceId"
                        END
                    )
                    AND arl."runId" <> tr.id
                    AND arl."leaseExpiresAt" > NOW()
                    AND EXISTS (
                        SELECT 1
                        FROM "TestRun" lockRun
                        WHERE lockRun.id = arl."runId"
                          AND lockRun."deletedAt" IS NULL
                          AND lockRun.status IN (${Prisma.join(ACTIVE_RUN_STATUSES)})
                    )
              )
            ORDER BY tr."createdAt" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        SELECT
            candidate.id,
            candidate."testCaseId",
            candidate."requiredCapability",
            candidate."requestedDeviceId",
            candidate."requestedRunnerId",
            candidate."hostFingerprint",
            candidate."resourceKey",
            candidate."resourceType"
        FROM candidate;
    `);

    const candidate = candidates[0];
    if (!candidate) {
        return null;
    }

    await input.tx.$executeRaw`
        DELETE FROM "AndroidResourceLock" arl
        WHERE arl."hostFingerprint" = ${candidate.hostFingerprint}
          AND arl."resourceKey" = ${candidate.resourceKey}
          AND (
            arl."leaseExpiresAt" <= NOW()
            OR NOT EXISTS (
                SELECT 1
                FROM "TestRun" lockRun
                WHERE lockRun.id = arl."runId"
                  AND lockRun."deletedAt" IS NULL
                  AND lockRun.status IN (${Prisma.join(ACTIVE_RUN_STATUSES)})
            )
          );
    `;

    const lockInserted = await input.tx.$executeRaw`
        INSERT INTO "AndroidResourceLock" (
            "hostFingerprint",
            "resourceKey",
            "resourceType",
            "runId",
            "runnerId",
            "leaseExpiresAt",
            "createdAt",
            "updatedAt"
        )
        VALUES (
            ${candidate.hostFingerprint},
            ${candidate.resourceKey},
            ${candidate.resourceType},
            ${candidate.id},
            ${input.runnerId},
            ${input.leaseExpiresAt},
            NOW(),
            NOW()
        )
        ON CONFLICT ("hostFingerprint", "resourceKey") DO NOTHING;
    `;
    if (lockInserted === 0) {
        return null;
    }

    const updateResult = await input.tx.testRun.updateMany({
        where: {
            id: candidate.id,
            status: TEST_STATUS.QUEUED,
            deletedAt: null,
            assignedRunnerId: null,
            requestedDeviceId: candidate.requestedDeviceId,
        },
        data: {
            assignedRunnerId: input.runnerId,
            leaseExpiresAt: input.leaseExpiresAt,
            status: TEST_STATUS.PREPARING,
            startedAt: new Date(),
        },
    });

    if (updateResult.count !== 1) {
        await input.tx.androidResourceLock.deleteMany({
            where: { runId: candidate.id },
        });
        return null;
    }

    return {
        id: candidate.id,
        testCaseId: candidate.testCaseId,
        requiredCapability: candidate.requiredCapability,
        requestedDeviceId: candidate.requestedDeviceId,
        requestedRunnerId: candidate.requestedRunnerId,
        leaseExpiresAt: input.leaseExpiresAt,
    };
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

        return null;
    });

    if (!claimed) {
        return null;
    }

    return {
        runId: claimed.id,
        testCaseId: claimed.testCaseId,
        requiredCapability: claimed.requiredCapability,
        requestedDeviceId: claimed.requestedDeviceId,
        requestedRunnerId: claimed.requestedRunnerId,
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
            explicitRequestedRunsBlockedByHostLocks: 0,
            blockedHostResourceKeys: [],
            genericQueuedRuns: 0,
            claimableDeviceIds: [],
        };
    }

    const claimableDeviceIds = await getClaimableDeviceIdsForRunner(input.runnerId);

    const queuedAndroidRuns = await prisma.testRun.count({
        where: {
            status: TEST_STATUS.QUEUED,
            deletedAt: null,
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
            status: TEST_STATUS.QUEUED,
            deletedAt: null,
            assignedRunnerId: null,
            requiredCapability: 'ANDROID',
            OR: [
                { requiredRunnerKind: null },
                { requiredRunnerKind: input.runnerKind },
            ],
            AND: [
                {
                    OR: [
                        { requestedRunnerId: null },
                        { requestedRunnerId: input.runnerId },
                    ],
                },
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
            status: TEST_STATUS.QUEUED,
            deletedAt: null,
            assignedRunnerId: null,
            requiredCapability: 'ANDROID',
                OR: [
                    { requiredRunnerKind: null },
                    { requiredRunnerKind: input.runnerKind },
                ],
                AND: [
                    {
                        OR: [
                            { requestedRunnerId: null },
                            { requestedRunnerId: input.runnerId },
                        ],
                    },
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
                status: TEST_STATUS.QUEUED,
                deletedAt: null,
                assignedRunnerId: null,
                requiredCapability: 'ANDROID',
                OR: [
                    { requiredRunnerKind: null },
                    { requiredRunnerKind: input.runnerKind },
                ],
                AND: [
                    {
                        OR: [
                            { requestedRunnerId: null },
                            { requestedRunnerId: input.runnerId },
                        ],
                    },
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
            status: TEST_STATUS.QUEUED,
            deletedAt: null,
            assignedRunnerId: null,
            requiredCapability: 'ANDROID',
            OR: [
                { requiredRunnerKind: null },
                { requiredRunnerKind: input.runnerKind },
            ],
            AND: [
                {
                    OR: [
                        { requestedRunnerId: null },
                        { requestedRunnerId: input.runnerId },
                    ],
                },
            ],
            requestedDeviceId: null,
            testCase: {
                project: {
                    teamId: input.teamId,
                },
            },
        },
    });

    const runnerContext = await prisma.runner.findUnique({
        where: { id: input.runnerId },
        select: { hostFingerprint: true },
    });

    let explicitRequestedRunsBlockedByHostLocks = 0;
    let blockedHostResourceKeys: string[] = [];

    if (runnerContext?.hostFingerprint) {
        const blockedRows = await prisma.$queryRaw<Array<{ blockedRunCount: number; resourceKeys: string[] | null }>>(Prisma.sql`
            WITH blocked_runs AS (
                SELECT
                    tr.id,
                    CASE
                        WHEN tr."requestedDeviceId" LIKE ${`${EMULATOR_PROFILE_DEVICE_PREFIX}%`}
                            THEN tr."requestedDeviceId"
                        ELSE ${CONNECTED_DEVICE_RESOURCE_PREFIX} || tr."requestedDeviceId"
                    END AS "resourceKey"
                FROM "TestRun" tr
                INNER JOIN "TestCase" tc ON tc.id = tr."testCaseId"
                INNER JOIN "Project" p ON p.id = tc."projectId"
                WHERE tr.status = ${TEST_STATUS.QUEUED}
                  AND tr."deletedAt" IS NULL
                  AND tr."assignedRunnerId" IS NULL
                  AND tr."requiredCapability" = 'ANDROID'
                  AND (tr."requiredRunnerKind" IS NULL OR tr."requiredRunnerKind" = ${input.runnerKind})
                  AND (tr."requestedRunnerId" IS NULL OR tr."requestedRunnerId" = ${input.runnerId})
                  AND tr."requestedDeviceId" IS NOT NULL
                  AND p."teamId" = ${input.teamId}
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
                  AND EXISTS (
                      SELECT 1
                      FROM "AndroidResourceLock" arl
                      WHERE arl."hostFingerprint" = ${runnerContext.hostFingerprint}
                        AND arl."resourceKey" = (
                            CASE
                                WHEN tr."requestedDeviceId" LIKE ${`${EMULATOR_PROFILE_DEVICE_PREFIX}%`}
                                    THEN tr."requestedDeviceId"
                                ELSE ${CONNECTED_DEVICE_RESOURCE_PREFIX} || tr."requestedDeviceId"
                            END
                        )
                        AND arl."runId" <> tr.id
                        AND arl."leaseExpiresAt" > NOW()
                        AND EXISTS (
                            SELECT 1
                            FROM "TestRun" lockRun
                            WHERE lockRun.id = arl."runId"
                              AND lockRun."deletedAt" IS NULL
                              AND lockRun.status IN (${Prisma.join(ACTIVE_RUN_STATUSES)})
                        )
                  )
            )
            SELECT
                COUNT(*)::int AS "blockedRunCount",
                COALESCE(ARRAY(SELECT DISTINCT br."resourceKey" FROM blocked_runs br ORDER BY br."resourceKey" LIMIT 20), ARRAY[]::text[]) AS "resourceKeys"
            FROM blocked_runs;
        `);

        const blockedSummary = blockedRows[0];
        explicitRequestedRunsBlockedByHostLocks = blockedSummary?.blockedRunCount ?? 0;
        blockedHostResourceKeys = blockedSummary?.resourceKeys ?? [];
    }

    let reasonCode: ClaimNoCandidateDiagnosis['reasonCode'] = 'RUN_AVAILABLE_BUT_LOCKED';
    if (queuedAndroidRuns === 0) {
        reasonCode = 'NO_QUEUED_RUNS';
    } else if (queuedCompatibleKindRuns === 0) {
        reasonCode = 'RUNNER_KIND_MISMATCH';
    } else if (explicitRequestedRuns > 0 && explicitRequestedRunsMatchingRunnerDevices === 0) {
        reasonCode = 'REQUESTED_DEVICE_UNAVAILABLE';
    } else if (explicitRequestedRunsBlockedByHostLocks > 0) {
        reasonCode = 'RUN_BLOCKED_BY_HOST_RESOURCE_LOCK';
    }

    return {
        reasonCode,
        queuedAndroidRuns,
        queuedCompatibleKindRuns,
        explicitRequestedRuns,
        explicitRequestedRunsMatchingRunnerDevices,
        explicitRequestedRunsBlockedByHostLocks,
        blockedHostResourceKeys,
        genericQueuedRuns,
        claimableDeviceIds,
    };
}
