import type { RunnerCapability, RunnerKind } from '@skytest/runner-protocol';
import { prisma } from '@/lib/core/prisma';
import { invalidateTeamAvailabilityCache } from '@/lib/runners/availability-service';

interface RunnerStatusRow {
    id: string;
    teamId: string;
    status: string;
    lastSeenAt: Date;
}

async function updateRunnerWithPinnedHostFingerprint(input: {
    runnerId: string;
    hostFingerprint: string;
    data: {
        label?: string;
        kind?: RunnerKind;
        capabilities?: RunnerCapability[];
        protocolVersion: string;
        runnerVersion: string;
        status: 'ONLINE';
        lastSeenAt: Date;
    };
}): Promise<RunnerStatusRow | null> {
    const updateResult = await prisma.runner.updateMany({
        where: {
            id: input.runnerId,
            hostFingerprint: input.hostFingerprint,
        },
        data: input.data,
    });

    if (updateResult.count !== 1) {
        return null;
    }

    return prisma.runner.findUnique({
        where: { id: input.runnerId },
        select: {
            id: true,
            teamId: true,
            status: true,
            lastSeenAt: true,
        },
    });
}

export async function registerRunner(input: {
    runnerId: string;
    hostFingerprint: string;
    label: string;
    kind: RunnerKind;
    capabilities: RunnerCapability[];
    protocolVersion: string;
    runnerVersion: string;
}) {
    const now = new Date();

    const runner = await updateRunnerWithPinnedHostFingerprint({
        runnerId: input.runnerId,
        hostFingerprint: input.hostFingerprint,
        data: {
            label: input.label,
            kind: input.kind,
            capabilities: input.capabilities,
            protocolVersion: input.protocolVersion,
            runnerVersion: input.runnerVersion,
            status: 'ONLINE',
            lastSeenAt: now,
        },
    });

    if (!runner) {
        return null;
    }

    invalidateTeamAvailabilityCache(runner.teamId);
    return runner;
}

export async function heartbeatRunner(input: {
    runnerId: string;
    hostFingerprint: string;
    protocolVersion: string;
    runnerVersion: string;
}) {
    const runner = await updateRunnerWithPinnedHostFingerprint({
        runnerId: input.runnerId,
        hostFingerprint: input.hostFingerprint,
        data: {
            protocolVersion: input.protocolVersion,
            runnerVersion: input.runnerVersion,
            status: 'ONLINE',
            lastSeenAt: new Date(),
        },
    });

    if (!runner) {
        return null;
    }

    invalidateTeamAvailabilityCache(runner.teamId);
    return runner;
}

export async function shutdownRunner(input: {
    runnerId: string;
}) {
    const runner = await prisma.runner.update({
        where: { id: input.runnerId },
        data: {
            status: 'OFFLINE',
            lastSeenAt: new Date(),
        },
        select: {
            id: true,
            teamId: true,
            status: true,
            lastSeenAt: true,
        },
    });

    invalidateTeamAvailabilityCache(runner.teamId);
    return runner;
}

export async function repairRunnerHostBinding(input: {
    runnerId: string;
    hostFingerprint: string;
    label: string;
    kind: RunnerKind;
    capabilities: RunnerCapability[];
    protocolVersion: string;
    runnerVersion: string;
}) {
    const now = new Date();

    const runner = await prisma.runner.update({
        where: { id: input.runnerId },
        data: {
            hostFingerprint: input.hostFingerprint,
            label: input.label,
            kind: input.kind,
            capabilities: input.capabilities,
            protocolVersion: input.protocolVersion,
            runnerVersion: input.runnerVersion,
            status: 'ONLINE',
            lastSeenAt: now,
        },
        select: {
            id: true,
            teamId: true,
            status: true,
            lastSeenAt: true,
        },
    });

    invalidateTeamAvailabilityCache(runner.teamId);
    return runner;
}
