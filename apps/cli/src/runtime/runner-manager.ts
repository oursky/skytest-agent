import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RUNNER_MINIMUM_VERSION, resolveHostFingerprint } from '@skytest/runner-protocol';
import type { LocalRunnerCredential, LocalRunnerDescriptor, LocalRunnerMetadata } from '../state/types';
import {
    clearRunnerPid,
    clearStateRoot,
    deleteRunner,
    ensureRunnerDirectories,
    listLocalRunnerIds,
    readRunnerCredential,
    readRunnerMetadata,
    readRunnerPid,
    resolveRunnerPaths,
    saveRunnerCredential,
    saveRunnerMetadata,
    writeRunnerPid,
} from '../state/store';
import { generateLocalRunnerId } from '../state/id';
import {
    ControlPlaneHttpError,
    exchangePairingToken,
    notifyRunnerShutdown,
    unpairRunnerRegistration,
} from './control-plane';
import { isProcessAlive, stopProcessWithTimeout } from './process';
import { reconcileRunnerCredential } from './runner-credential-reconcile';
import {
    startManagedRunnerProcess,
} from './runner-process-supervision';

export { resolveManagedMidsceneRunDir } from './runner-process-supervision';

const DEFAULT_CONTROL_PLANE_URL = process.env.RUNNER_CONTROL_PLANE_URL ?? 'http://127.0.0.1:3000';
const DEFAULT_RUNNER_VERSION = process.env.RUNNER_VERSION ?? RUNNER_MINIMUM_VERSION;
const STOP_TIMEOUT_MS = 5_000;
const RUNNER_CREDENTIAL_REVOKED_FILE = 'credential-revoked.json';

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function defaultRunnerLabel(localRunnerId: string): string {
    const host = os.hostname().trim() || 'host';
    return `${host}-${localRunnerId}`;
}

function maskRunnerToken(runnerToken: string): string {
    if (runnerToken.length <= 8) {
        return '********';
    }
    return `${runnerToken.slice(0, 4)}...${runnerToken.slice(-4)}`;
}

async function requireRunnerMetadata(localRunnerId: string): Promise<LocalRunnerMetadata> {
    const metadata = await readRunnerMetadata(localRunnerId);
    if (!metadata) {
        throw new Error(`Runner '${localRunnerId}' is not paired.`);
    }
    return metadata;
}

async function requireRunnerCredential(localRunnerId: string): Promise<LocalRunnerCredential> {
    const credential = await readRunnerCredential(localRunnerId);
    if (!credential) {
        throw new Error(`Runner '${localRunnerId}' has no stored credential.`);
    }
    return credential;
}

async function resolveLocalRunnerId(runnerIdentifier: string): Promise<string> {
    const normalizedIdentifier = runnerIdentifier.trim();
    if (normalizedIdentifier.length === 0) {
        throw new Error('Runner ID is required.');
    }

    const directMatch = await readRunnerMetadata(normalizedIdentifier);
    if (directMatch) {
        return normalizedIdentifier;
    }

    const localRunnerIds = await listLocalRunnerIds();
    for (const localRunnerId of localRunnerIds) {
        const metadata = await readRunnerMetadata(localRunnerId);
        if (metadata?.serverRunnerId === normalizedIdentifier) {
            return localRunnerId;
        }
    }

    const prefixMatches: string[] = [];
    for (const localRunnerId of localRunnerIds) {
        const metadata = await readRunnerMetadata(localRunnerId);
        if (!metadata) {
            continue;
        }

        if (localRunnerId.startsWith(normalizedIdentifier) || metadata.serverRunnerId.startsWith(normalizedIdentifier)) {
            prefixMatches.push(localRunnerId);
        }
    }

    if (prefixMatches.length === 1) {
        return prefixMatches[0];
    }

    if (prefixMatches.length > 1) {
        throw new Error(`Runner identifier '${runnerIdentifier}' is ambiguous. Use \`skytest get runners\` and provide a more specific ID.`);
    }

    throw new Error(`Runner '${runnerIdentifier}' is not paired.`);
}

async function determineRunnerStatus(localRunnerId: string): Promise<{ pid: number | null; status: 'RUNNING' | 'STOPPED' }> {
    const pid = await readRunnerPid(localRunnerId);
    if (!pid) {
        return { pid: null, status: 'STOPPED' };
    }

    if (!isProcessAlive(pid)) {
        await clearRunnerPid(localRunnerId);
        return { pid: null, status: 'STOPPED' };
    }

    return { pid, status: 'RUNNING' };
}

async function isRunnerCredentialRevoked(localRunnerId: string): Promise<boolean> {
    const { runtimeStateDir } = resolveRunnerPaths(localRunnerId);
    try {
        await readFile(path.join(runtimeStateDir, RUNNER_CREDENTIAL_REVOKED_FILE), 'utf8');
        return true;
    } catch {
        return false;
    }
}

async function removeLocalRunnerState(localRunnerId: string): Promise<void> {
    const pid = await readRunnerPid(localRunnerId);
    if (pid && isProcessAlive(pid)) {
        await stopProcessWithTimeout(pid, STOP_TIMEOUT_MS);
    }
    await clearRunnerPid(localRunnerId);
    await deleteRunner(localRunnerId);
}

export interface PairRunnerOptions {
    pairingToken: string;
    label?: string;
    controlPlaneBaseUrl?: string;
    autoStart: boolean;
}

export interface PairRunnerResult {
    localRunnerId: string;
    serverRunnerId: string;
    label: string;
    controlPlaneBaseUrl: string;
    started: boolean;
    pid: number | null;
}

export async function pairRunner(options: PairRunnerOptions): Promise<PairRunnerResult> {
    const existingIds = new Set(await listLocalRunnerIds());
    const localRunnerId = generateLocalRunnerId(existingIds);
    const label = options.label?.trim() || defaultRunnerLabel(localRunnerId);
    const controlPlaneBaseUrl = normalizeBaseUrl(options.controlPlaneBaseUrl?.trim() || DEFAULT_CONTROL_PLANE_URL);

    const exchanged = await exchangePairingToken({
        pairingToken: options.pairingToken,
        controlPlaneBaseUrl,
        hostFingerprint: resolveHostFingerprint(),
        displayId: localRunnerId,
        label,
        runnerVersion: DEFAULT_RUNNER_VERSION,
    });

    const now = new Date().toISOString();
    const metadata: LocalRunnerMetadata = {
        localRunnerId,
        serverRunnerId: exchanged.runnerId,
        label,
        controlPlaneBaseUrl,
        createdAt: now,
        updatedAt: now,
    };

    const credential: LocalRunnerCredential = {
        runnerToken: exchanged.runnerToken,
        runnerId: exchanged.runnerId,
        credentialExpiresAt: exchanged.credentialExpiresAt,
        transport: exchanged.transport,
        updatedAt: now,
    };

    await ensureRunnerDirectories(localRunnerId);
    await saveRunnerMetadata(localRunnerId, metadata);
    await saveRunnerCredential(localRunnerId, credential);

    if (!options.autoStart) {
        return {
            localRunnerId,
            serverRunnerId: exchanged.runnerId,
            label,
            controlPlaneBaseUrl,
            started: false,
            pid: null,
        };
    }

    const startResult = await startRunner(localRunnerId);
    return {
        localRunnerId,
        serverRunnerId: exchanged.runnerId,
        label,
        controlPlaneBaseUrl,
        started: true,
        pid: startResult.pid,
    };
}

export interface StartRunnerResult {
    localRunnerId: string;
    pid: number;
    alreadyRunning: boolean;
    logPath: string;
    autoRepaired: boolean;
}

export async function startRunner(
    runnerIdentifier: string,
    options?: { repairPairingToken?: string }
): Promise<StartRunnerResult> {
    const localRunnerId = await resolveLocalRunnerId(runnerIdentifier);
    let metadata = await requireRunnerMetadata(localRunnerId);
    let credential = await requireRunnerCredential(localRunnerId);
    const runnerPaths = resolveRunnerPaths(localRunnerId);

    await ensureRunnerDirectories(localRunnerId);

    let autoRepaired = false;
    const reconciled = await reconcileRunnerCredential({
        localRunnerId,
        metadata,
        credential,
        repairPairingToken: options?.repairPairingToken,
        bestEffort: true,
        onRevokedCredential: removeLocalRunnerState,
    });
    if (!reconciled) {
        throw new Error(
            `Runner '${runnerIdentifier}' is no longer paired on server. Local CLI state was removed. Run \`skytest pair runner "<pairing-token>" --url "${metadata.controlPlaneBaseUrl}"\` to pair again.`
        );
    }
    if (reconciled.credential.runnerToken !== credential.runnerToken) {
        autoRepaired = true;
    }
    metadata = reconciled.metadata;
    credential = reconciled.credential;

    const existingPid = await readRunnerPid(localRunnerId);
    if (existingPid && isProcessAlive(existingPid)) {
        return {
            localRunnerId,
            pid: existingPid,
            alreadyRunning: true,
            logPath: runnerPaths.logPath,
            autoRepaired,
        };
    }

    if (existingPid && !isProcessAlive(existingPid)) {
        await clearRunnerPid(localRunnerId);
    }

    const pid = await startManagedRunnerProcess({
        localRunnerId,
        metadata,
        credential,
        runtimeStateDir: runnerPaths.runtimeStateDir,
        logPath: runnerPaths.logPath,
    });

    await writeRunnerPid(localRunnerId, pid);
    await saveRunnerMetadata(localRunnerId, {
        ...metadata,
        updatedAt: new Date().toISOString(),
        lastStartedAt: new Date().toISOString(),
    });

    return {
        localRunnerId,
        pid,
        alreadyRunning: false,
        logPath: runnerPaths.logPath,
        autoRepaired,
    };
}

export async function stopRunner(runnerIdentifier: string): Promise<{
    localRunnerId: string;
    stopped: boolean;
    pid: number | null;
    serverMarkedOffline: boolean;
}> {
    const localRunnerId = await resolveLocalRunnerId(runnerIdentifier);
    const metadata = await requireRunnerMetadata(localRunnerId);
    const credential = await requireRunnerCredential(localRunnerId);
    let serverMarkedOffline = false;

    try {
        await notifyRunnerShutdown({
            controlPlaneBaseUrl: metadata.controlPlaneBaseUrl,
            runnerToken: credential.runnerToken,
            runnerVersion: DEFAULT_RUNNER_VERSION,
            reason: 'CLI stop command',
        });
        serverMarkedOffline = true;
    } catch {
    }

    const pid = await readRunnerPid(localRunnerId);

    if (!pid) {
        return {
            localRunnerId,
            stopped: false,
            pid: null,
            serverMarkedOffline,
        };
    }

    const stopResult = await stopProcessWithTimeout(pid, STOP_TIMEOUT_MS);
    if (stopResult === 'failed') {
        throw new Error(`Failed to stop runner process ${pid}.`);
    }
    await clearRunnerPid(localRunnerId);
    await saveRunnerMetadata(localRunnerId, {
        ...metadata,
        updatedAt: new Date().toISOString(),
        lastStoppedAt: new Date().toISOString(),
    });

    return {
        localRunnerId,
        stopped: true,
        pid,
        serverMarkedOffline,
    };
}

export async function getRunners(): Promise<LocalRunnerDescriptor[]> {
    const synced = await syncRunners();
    return synced.runners;
}

export interface SyncRunnersResult {
    runners: LocalRunnerDescriptor[];
    removedLocalRunnerIds: string[];
}

export async function syncRunners(): Promise<SyncRunnersResult> {
    const localRunnerIds = await listLocalRunnerIds();
    const descriptors: LocalRunnerDescriptor[] = [];
    const removedLocalRunnerIds: string[] = [];

    for (const localRunnerId of localRunnerIds) {
        if (await isRunnerCredentialRevoked(localRunnerId)) {
            try {
                await stopRunner(localRunnerId);
            } catch {
            }
            await deleteRunner(localRunnerId);
            removedLocalRunnerIds.push(localRunnerId);
            continue;
        }

        const metadata = await readRunnerMetadata(localRunnerId);
        const credential = await readRunnerCredential(localRunnerId);
        if (!metadata || !credential) {
            continue;
        }

        const reconciled = await reconcileRunnerCredential({
            localRunnerId,
            metadata,
            credential,
            bestEffort: true,
            onRevokedCredential: removeLocalRunnerState,
        });
        if (!reconciled) {
            removedLocalRunnerIds.push(localRunnerId);
            continue;
        }

        const runtime = await determineRunnerStatus(localRunnerId);
        descriptors.push({
            metadata: reconciled.metadata,
            credential: reconciled.credential,
            pid: runtime.pid,
            status: runtime.status,
            logPath: resolveRunnerPaths(localRunnerId).logPath,
        });
    }

    return {
        runners: descriptors,
        removedLocalRunnerIds,
    };
}

export async function describeRunner(runnerIdentifier: string): Promise<LocalRunnerDescriptor & { maskedRunnerToken: string }> {
    const localRunnerId = await resolveLocalRunnerId(runnerIdentifier);
    const metadata = await requireRunnerMetadata(localRunnerId);
    const credential = await requireRunnerCredential(localRunnerId);
    const reconciled = await reconcileRunnerCredential({
        localRunnerId,
        metadata,
        credential,
        bestEffort: true,
        onRevokedCredential: removeLocalRunnerState,
    });
    if (!reconciled) {
        throw new Error(`Runner '${runnerIdentifier}' is no longer paired on server and was removed locally.`);
    }
    const runtime = await determineRunnerStatus(localRunnerId);

    return {
        metadata: reconciled.metadata,
        credential: reconciled.credential,
        pid: runtime.pid,
        status: runtime.status,
        logPath: resolveRunnerPaths(localRunnerId).logPath,
        maskedRunnerToken: maskRunnerToken(reconciled.credential.runnerToken),
    };
}

export async function unpairRunner(runnerIdentifier: string): Promise<{ localRunnerId: string; removed: boolean }> {
    let localRunnerId: string;
    try {
        localRunnerId = await resolveLocalRunnerId(runnerIdentifier);
    } catch {
        return { localRunnerId: runnerIdentifier, removed: false };
    }

    const metadata = await readRunnerMetadata(localRunnerId);
    if (!metadata) {
        return { localRunnerId, removed: false };
    }

    const credential = await readRunnerCredential(localRunnerId);
    if (credential) {
        try {
            await unpairRunnerRegistration({
                controlPlaneBaseUrl: metadata.controlPlaneBaseUrl,
                runnerToken: credential.runnerToken,
                runnerVersion: DEFAULT_RUNNER_VERSION,
                reason: 'CLI unpair command',
            });
        } catch (error) {
            if (!(error instanceof ControlPlaneHttpError) || (error.status !== 401 && error.status !== 404)) {
                throw error;
            }
        }
    }

    await removeLocalRunnerState(localRunnerId);
    return { localRunnerId, removed: true };
}

export async function resetAllRunners(force: boolean): Promise<{ removedRunners: number }> {
    if (!force) {
        throw new Error('Reset is destructive. Re-run with `skytest reset --force`.');
    }

    const localRunnerIds = await listLocalRunnerIds();
    for (const localRunnerId of localRunnerIds) {
        const pid = await readRunnerPid(localRunnerId);
        if (pid && isProcessAlive(pid)) {
            const stopResult = await stopProcessWithTimeout(pid, STOP_TIMEOUT_MS);
            if (stopResult === 'failed') {
                throw new Error(`Failed to stop runner process ${pid} during reset.`);
            }
        }
    }

    await clearStateRoot();
    return { removedRunners: localRunnerIds.length };
}

export async function readRunnerLog(runnerIdentifier: string): Promise<string> {
    const localRunnerId = await resolveLocalRunnerId(runnerIdentifier);
    await requireRunnerMetadata(localRunnerId);
    const logPath = resolveRunnerPaths(localRunnerId).logPath;
    try {
        return await readFile(logPath, 'utf8');
    } catch {
        return '';
    }
}
