import type { RunnerCapability, RunnerKind } from '@skytest/runner-protocol';
import { prisma } from '@/lib/core/prisma';
import { generatePairingToken, generateRunnerToken, hashRunnerToken, isPairingTokenFormat } from '@/lib/runners/credentials';

const DEFAULT_PAIRING_TOKEN_TTL_MINUTES = 10;
const MAX_PAIRING_TOKEN_TTL_MINUTES = 60;
const RUNNER_CREDENTIAL_TTL_DAYS = 30;

function resolvePairingExpiresAt(ttlMinutes: number | undefined): Date {
    const boundedMinutes = ttlMinutes
        ? Math.max(1, Math.min(MAX_PAIRING_TOKEN_TTL_MINUTES, ttlMinutes))
        : DEFAULT_PAIRING_TOKEN_TTL_MINUTES;
    return new Date(Date.now() + boundedMinutes * 60 * 1000);
}

function resolveRunnerCredentialExpiresAt(now: Date): Date {
    return new Date(now.getTime() + RUNNER_CREDENTIAL_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export async function createPairingToken(input: {
    teamId: string;
    createdByUserId: string;
    ttlMinutes?: number;
}) {
    const { raw, hash, prefix } = generatePairingToken();
    const expiresAt = resolvePairingExpiresAt(input.ttlMinutes);

    await prisma.runnerToken.create({
        data: {
            teamId: input.teamId,
            createdByUserId: input.createdByUserId,
            kind: 'PAIRING',
            prefix,
            hash,
            expiresAt,
        },
    });

    return { token: raw, expiresAt };
}

export async function exchangePairingToken(input: {
    pairingToken: string;
    label: string;
    kind: RunnerKind;
    capabilities: RunnerCapability[];
    protocolVersion: string;
    runnerVersion: string;
}) {
    if (!isPairingTokenFormat(input.pairingToken)) {
        return null;
    }

    const now = new Date();
    const pairingHash = hashRunnerToken(input.pairingToken);
    const pairing = await prisma.runnerToken.findUnique({
        where: { hash: pairingHash },
        select: {
            id: true,
            teamId: true,
            kind: true,
            revokedAt: true,
            consumedAt: true,
            expiresAt: true,
        },
    });

    if (!pairing) {
        return null;
    }
    if (pairing.kind !== 'PAIRING' || pairing.revokedAt || pairing.consumedAt) {
        return null;
    }
    if (pairing.expiresAt.getTime() <= now.getTime()) {
        return null;
    }

    return prisma.$transaction(async (tx) => {
        const consumeResult = await tx.runnerToken.updateMany({
            where: {
                id: pairing.id,
                consumedAt: null,
                revokedAt: null,
            },
            data: {
                consumedAt: now,
            },
        });

        if (consumeResult.count !== 1) {
            return null;
        }

        const runner = await tx.runner.create({
            data: {
                teamId: pairing.teamId,
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
            },
        });

        const runnerCredential = generateRunnerToken();
        const credentialExpiresAt = resolveRunnerCredentialExpiresAt(now);

        await tx.runnerToken.create({
            data: {
                teamId: pairing.teamId,
                runnerId: runner.id,
                kind: 'RUNNER',
                prefix: runnerCredential.prefix,
                hash: runnerCredential.hash,
                expiresAt: credentialExpiresAt,
            },
        });

        await tx.runnerToken.update({
            where: { id: pairing.id },
            data: { runnerId: runner.id },
        });

        return {
            runnerId: runner.id,
            teamId: runner.teamId,
            runnerToken: runnerCredential.raw,
            credentialExpiresAt,
        };
    });
}
