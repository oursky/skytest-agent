import type { RunnerCapability, RunnerKind } from '@skytest/runner-protocol';
import { prisma } from '@/lib/core/prisma';

export async function registerRunner(input: {
    runnerId: string;
    label: string;
    kind: RunnerKind;
    capabilities: RunnerCapability[];
    protocolVersion: string;
    runnerVersion: string;
}) {
    const now = new Date();

    return prisma.runner.update({
        where: { id: input.runnerId },
        data: {
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
}

export async function heartbeatRunner(input: {
    runnerId: string;
    protocolVersion: string;
    runnerVersion: string;
}) {
    return prisma.runner.update({
        where: { id: input.runnerId },
        data: {
            protocolVersion: input.protocolVersion,
            runnerVersion: input.runnerVersion,
            status: 'ONLINE',
            lastSeenAt: new Date(),
        },
        select: {
            id: true,
            teamId: true,
            status: true,
            lastSeenAt: true,
        },
    });
}
