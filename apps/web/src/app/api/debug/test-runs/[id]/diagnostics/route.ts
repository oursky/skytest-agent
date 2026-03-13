import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { prisma } from '@/lib/core/prisma';
import { getTeamRunnersOverview } from '@/lib/runners/availability-service';
import { diagnoseNoClaimForRunner } from '@/lib/runners/claim-service';
import { BROWSER_EXECUTION_CAPABILITY } from '@/lib/runners/constants';
import {
    ACTIVE_LOCKED_RUN_STATUSES,
    buildHostResourceKey,
    EMULATOR_PROFILE_DEVICE_PREFIX,
} from '@/lib/runners/android-resource-lock';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { isTestRunProjectMember } from '@/lib/security/permissions';
import { TEST_STATUS } from '@/types';

const logger = createLogger('api:debug:test-run-diagnostics');

export const dynamic = 'force-dynamic';

type RunClaimabilityReasonCode =
    | 'RUN_NOT_QUEUED'
    | 'RUN_ASSIGNED_WITH_ACTIVE_LEASE'
    | 'NO_ELIGIBLE_FRESH_RUNNERS'
    | 'REQUESTED_DEVICE_LOCKED_ON_HOST'
    | 'REQUESTED_DEVICE_NOT_CLAIMABLE'
    | 'CLAIMABLE_NOW';

function runnerSupportsRequiredCapability(
    capabilities: string[],
    requiredCapability: string | null
): boolean {
    if (!requiredCapability) {
        return true;
    }
    return capabilities.includes(requiredCapability);
}

function runnerSupportsRequiredKind(runnerKind: string, requiredRunnerKind: string | null): boolean {
    if (!requiredRunnerKind) {
        return true;
    }
    return runnerKind === requiredRunnerKind;
}

function isRequestedDeviceClaimable(deviceId: string, state: string): boolean {
    if (deviceId.startsWith(EMULATOR_PROFILE_DEVICE_PREFIX)) {
        return state === 'ONLINE' || state === 'OFFLINE';
    }
    return state === 'ONLINE';
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id: runId } = await params;
        const run = await prisma.testRun.findUnique({
            where: { id: runId },
            select: {
                id: true,
                status: true,
                requiredCapability: true,
                requiredRunnerKind: true,
                requestedDeviceId: true,
                requestedRunnerId: true,
                assignedRunnerId: true,
                leaseExpiresAt: true,
                startedAt: true,
                completedAt: true,
                createdAt: true,
                lastEventAt: true,
                testCase: {
                    select: {
                        project: {
                            select: {
                                teamId: true,
                            },
                        },
                    },
                },
            },
        });

        if (!run) {
            return NextResponse.json({ error: 'Test run not found' }, { status: 404 });
        }

        if (!await isTestRunProjectMember(userId, runId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const teamId = run.testCase.project.teamId;
        const [runnersOverview, teamRunners] = await Promise.all([
            getTeamRunnersOverview(teamId),
            prisma.runner.findMany({
                where: { teamId },
                select: {
                    id: true,
                    label: true,
                    hostFingerprint: true,
                    kind: true,
                    status: true,
                    lastSeenAt: true,
                    capabilities: true,
                    protocolVersion: true,
                    runnerVersion: true,
                    devices: {
                        select: {
                            id: true,
                            deviceId: true,
                            platform: true,
                            name: true,
                            state: true,
                            metadata: true,
                            lastSeenAt: true,
                        },
                    },
                },
                orderBy: { label: 'asc' },
            }),
        ]);

        const runnerFreshnessById = new Map(
            runnersOverview.runners.map((runner) => [runner.id, runner.isFresh])
        );
        const runnerSnapshots = teamRunners.map((runner) => {
            const claimableDeviceIds = runner.devices
                .filter((device) => isRequestedDeviceClaimable(device.deviceId, device.state))
                .map((device) => device.deviceId);

            return {
                id: runner.id,
                label: runner.label,
                hostFingerprint: runner.hostFingerprint,
                kind: runner.kind,
                status: runner.status,
                capabilities: runner.capabilities,
                protocolVersion: runner.protocolVersion,
                runnerVersion: runner.runnerVersion,
                lastSeenAt: runner.lastSeenAt.toISOString(),
                isFresh: runnerFreshnessById.get(runner.id) ?? false,
                deviceCount: runner.devices.length,
                claimableDeviceIds,
            };
        });

        const teamDevices = teamRunners.flatMap((runner) => (
            runner.devices.map((device) => ({
                id: device.id,
                runnerId: runner.id,
                runnerLabel: runner.label,
                deviceId: device.deviceId,
                name: device.name,
                platform: device.platform,
                state: device.state,
                metadata: device.metadata,
                lastSeenAt: device.lastSeenAt.toISOString(),
                isClaimable: isRequestedDeviceClaimable(device.deviceId, device.state),
            }))
        ));

        const eligibleRunners = runnerSnapshots.filter((runner) => (
            runner.status === 'ONLINE'
            && runner.isFresh
            && runnerSupportsRequiredKind(runner.kind, run.requiredRunnerKind)
            && runnerSupportsRequiredCapability(runner.capabilities, run.requiredCapability)
        ));
        const requestedDeviceId = run.requestedDeviceId;
        const requestedRunnerId = run.requestedRunnerId;
        const eligibleRunnersWithinRequestedScope = requestedRunnerId
            ? eligibleRunners.filter((runner) => runner.id === requestedRunnerId)
            : eligibleRunners;

        const requestedResourceKey = requestedDeviceId ? buildHostResourceKey(requestedDeviceId) : null;
        const activeResourceLocks = requestedResourceKey
            ? await prisma.androidResourceLock.findMany({
                where: {
                    resourceKey: requestedResourceKey,
                    leaseExpiresAt: { gt: new Date() },
                    runner: { teamId },
                    run: {
                        deletedAt: null,
                        status: { in: [...ACTIVE_LOCKED_RUN_STATUSES] },
                    },
                },
                select: {
                    hostFingerprint: true,
                    resourceKey: true,
                    resourceType: true,
                    runId: true,
                    runnerId: true,
                    leaseExpiresAt: true,
                    runner: {
                        select: {
                            label: true,
                            displayId: true,
                        },
                    },
                    run: {
                        select: {
                            status: true,
                            requestedDeviceId: true,
                            requestedRunnerId: true,
                        },
                    },
                },
                orderBy: { leaseExpiresAt: 'desc' },
            })
            : [];

        const nowMs = Date.now();
        const hasActiveAssignmentLease = Boolean(
            run.assignedRunnerId
            && run.leaseExpiresAt
            && run.leaseExpiresAt.getTime() > nowMs
        );

        let claimabilityReasonCode: RunClaimabilityReasonCode = 'CLAIMABLE_NOW';
        let claimableNow = true;
        let matchingRequestedDeviceRunnerIds: string[] = [];
        const isBrowserRun = run.requiredCapability === BROWSER_EXECUTION_CAPABILITY;

        if (run.status !== TEST_STATUS.QUEUED) {
            claimabilityReasonCode = 'RUN_NOT_QUEUED';
            claimableNow = false;
        } else if (hasActiveAssignmentLease) {
            claimabilityReasonCode = 'RUN_ASSIGNED_WITH_ACTIVE_LEASE';
            claimableNow = false;
        } else if (isBrowserRun) {
            claimabilityReasonCode = 'CLAIMABLE_NOW';
            claimableNow = true;
        } else if (eligibleRunners.length === 0) {
            claimabilityReasonCode = 'NO_ELIGIBLE_FRESH_RUNNERS';
            claimableNow = false;
        } else if (requestedDeviceId) {
            matchingRequestedDeviceRunnerIds = eligibleRunnersWithinRequestedScope
                .filter((runner) => (
                    runner.claimableDeviceIds.includes(requestedDeviceId)
                ))
                .map((runner) => runner.id);
            const candidateHostFingerprints = new Set(
                eligibleRunnersWithinRequestedScope
                    .filter((runner) => runner.claimableDeviceIds.includes(requestedDeviceId))
                    .map((runner) => runner.hostFingerprint)
                    .filter((fingerprint): fingerprint is string => Boolean(fingerprint))
            );
            const blockingLocks = activeResourceLocks.filter((lock) => candidateHostFingerprints.has(lock.hostFingerprint));

            if (blockingLocks.length > 0) {
                claimabilityReasonCode = 'REQUESTED_DEVICE_LOCKED_ON_HOST';
                claimableNow = false;
            } else if (matchingRequestedDeviceRunnerIds.length === 0) {
                claimabilityReasonCode = 'REQUESTED_DEVICE_NOT_CLAIMABLE';
                claimableNow = false;
            }
        }

        const runnerNoClaimDiagnosis = await Promise.all(
            teamRunners.map(async (runner) => ({
                runnerId: runner.id,
                runnerLabel: runner.label,
                kind: runner.kind,
                status: runner.status,
                isFresh: runnerFreshnessById.get(runner.id) ?? false,
                diagnosis: await diagnoseNoClaimForRunner({
                    runnerId: runner.id,
                    teamId,
                    runnerKind: runner.kind,
                    capabilities: runner.capabilities,
                }),
            }))
        );

        const [queuedRunsInTeam, queuedRunsWithSameConstraints] = await Promise.all([
            prisma.testRun.count({
                where: {
                    status: TEST_STATUS.QUEUED,
                    assignedRunnerId: null,
                    testCase: {
                        project: {
                            teamId,
                        },
                    },
                },
            }),
            prisma.testRun.count({
                where: {
                    status: TEST_STATUS.QUEUED,
                    assignedRunnerId: null,
                    requiredCapability: run.requiredCapability,
                    requiredRunnerKind: run.requiredRunnerKind,
                    requestedDeviceId: run.requestedDeviceId,
                    requestedRunnerId: run.requestedRunnerId,
                    testCase: {
                        project: {
                            teamId,
                        },
                    },
                },
            }),
        ]);

        return NextResponse.json({
            run: {
                id: run.id,
                status: run.status,
                requiredCapability: run.requiredCapability,
                requiredRunnerKind: run.requiredRunnerKind,
                requestedDeviceId: run.requestedDeviceId,
                requestedRunnerId: run.requestedRunnerId,
                assignedRunnerId: run.assignedRunnerId,
                leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null,
                startedAt: run.startedAt?.toISOString() ?? null,
                completedAt: run.completedAt?.toISOString() ?? null,
                createdAt: run.createdAt.toISOString(),
                lastEventAt: run.lastEventAt?.toISOString() ?? null,
            },
            claimability: {
                claimableNow,
                reasonCode: claimabilityReasonCode,
                eligibleRunnerCount: eligibleRunners.length,
                eligibleRunnerIds: eligibleRunners.map((runner) => runner.id),
                matchingRequestedDeviceRunnerIds,
                requestedResourceKey,
                activeResourceLocks,
                hasActiveAssignmentLease,
            },
            queueSnapshot: {
                queuedRunsInTeam,
                queuedRunsWithSameConstraints,
            },
            teamRunners: runnerSnapshots,
            teamDevices,
            runnerNoClaimDiagnosis,
            generatedAt: new Date(nowMs).toISOString(),
        });
    } catch (error) {
        logger.error('Failed to load test run diagnostics', error);
        return NextResponse.json({ error: 'Failed to load test run diagnostics' }, { status: 500 });
    }
}
