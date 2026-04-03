import { rm } from 'node:fs/promises';
import path from 'node:path';
import { RUNNER_MINIMUM_VERSION, resolveHostFingerprint } from '@skytest/runner-protocol';
import type { LocalRunnerCredential, LocalRunnerMetadata } from '../state/types';
import { resolveRunnerPaths, saveRunnerCredential, saveRunnerMetadata } from '../state/store';
import { ControlPlaneHttpError, exchangePairingToken, verifyRunnerCredential } from './control-plane';

const DEFAULT_RUNNER_VERSION = process.env.RUNNER_VERSION ?? RUNNER_MINIMUM_VERSION;
const RUNNER_CREDENTIAL_REVOKED_FILE = 'credential-revoked.json';
const START_REPAIR_PAIRING_TOKEN_ENV = 'SKYTEST_REPAIR_PAIRING_TOKEN';

export function resolveRepairPairingToken(overrideToken?: string): string | null {
    const override = overrideToken?.trim();
    if (override) {
        return override;
    }
    const envToken = process.env[START_REPAIR_PAIRING_TOKEN_ENV]?.trim();
    return envToken && envToken.length > 0 ? envToken : null;
}

async function repairRunnerCredential(input: {
    localRunnerId: string;
    metadata: LocalRunnerMetadata;
    pairingToken: string;
}): Promise<{ metadata: LocalRunnerMetadata; credential: LocalRunnerCredential }> {
    const exchanged = await exchangePairingToken({
        pairingToken: input.pairingToken,
        controlPlaneBaseUrl: input.metadata.controlPlaneBaseUrl,
        hostFingerprint: resolveHostFingerprint(),
        displayId: input.localRunnerId,
        label: input.metadata.label,
        runnerVersion: DEFAULT_RUNNER_VERSION,
    });

    const now = new Date().toISOString();
    const nextMetadata: LocalRunnerMetadata = {
        ...input.metadata,
        serverRunnerId: exchanged.runnerId,
        updatedAt: now,
    };
    const nextCredential: LocalRunnerCredential = {
        runnerToken: exchanged.runnerToken,
        runnerId: exchanged.runnerId,
        credentialExpiresAt: exchanged.credentialExpiresAt,
        transport: exchanged.transport,
        updatedAt: now,
    };

    await Promise.all([
        saveRunnerMetadata(input.localRunnerId, nextMetadata),
        saveRunnerCredential(input.localRunnerId, nextCredential),
    ]);
    await rm(path.join(resolveRunnerPaths(input.localRunnerId).runtimeStateDir, RUNNER_CREDENTIAL_REVOKED_FILE), { force: true });

    return { metadata: nextMetadata, credential: nextCredential };
}

export async function reconcileRunnerCredential(input: {
    localRunnerId: string;
    metadata: LocalRunnerMetadata;
    credential: LocalRunnerCredential;
    repairPairingToken?: string;
    bestEffort?: boolean;
    onRevokedCredential: (localRunnerId: string) => Promise<void>;
}): Promise<{ metadata: LocalRunnerMetadata; credential: LocalRunnerCredential } | null> {
    try {
        await verifyRunnerCredential({
            controlPlaneBaseUrl: input.metadata.controlPlaneBaseUrl,
            runnerToken: input.credential.runnerToken,
            runnerVersion: DEFAULT_RUNNER_VERSION,
        });
        return {
            metadata: input.metadata,
            credential: input.credential,
        };
    } catch (error) {
        if (!(error instanceof ControlPlaneHttpError) || error.status !== 401) {
            if (input.bestEffort) {
                return {
                    metadata: input.metadata,
                    credential: input.credential,
                };
            }
            throw error;
        }

        const repairPairingToken = resolveRepairPairingToken(input.repairPairingToken);
        if (!repairPairingToken) {
            await input.onRevokedCredential(input.localRunnerId);
            return null;
        }

        return repairRunnerCredential({
            localRunnerId: input.localRunnerId,
            metadata: input.metadata,
            pairingToken: repairPairingToken,
        });
    }
}
