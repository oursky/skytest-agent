import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
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
import { exchangePairingToken } from './control-plane';
import { isProcessAlive, startDetachedRunnerProcess, stopProcessWithTimeout } from './process';

const DEFAULT_CONTROL_PLANE_URL = process.env.RUNNER_CONTROL_PLANE_URL ?? 'http://127.0.0.1:3000';
const DEFAULT_RUNNER_VERSION = process.env.RUNNER_VERSION ?? '0.1.0';
const STOP_TIMEOUT_MS = 5_000;
const RUNNER_CREDENTIAL_REVOKED_FILE = 'credential-revoked.json';

function resolveRepoRoot(): string {
    const currentFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(currentFile), '../../../..');
}

function resolveRunnerEnvFileCandidates(): string[] {
    const env = process.env.NODE_ENV ?? 'development';
    return [
        '.env',
        '.env.local',
        `.env.${env}`,
        `.env.${env}.local`,
    ];
}

async function loadLocalRunnerEnv(): Promise<NodeJS.ProcessEnv> {
    const repoRoot = resolveRepoRoot();
    const files = resolveRunnerEnvFileCandidates();
    const result: NodeJS.ProcessEnv = {
        NODE_ENV: process.env.NODE_ENV,
    };

    for (const file of files) {
        const filePath = path.join(repoRoot, file);
        try {
            const content = await readFile(filePath, 'utf8');
            const parsed = parseEnv(content);
            for (const [key, value] of Object.entries(parsed)) {
                if (value !== undefined) {
                    result[key] = value;
                }
            }
        } catch {
            // ignore missing or unreadable env file candidates
        }
    }

    return result;
}

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
}

export async function startRunner(localRunnerId: string): Promise<StartRunnerResult> {
    const metadata = await requireRunnerMetadata(localRunnerId);
    const credential = await requireRunnerCredential(localRunnerId);
    const runnerPaths = resolveRunnerPaths(localRunnerId);

    await ensureRunnerDirectories(localRunnerId);

    const existingPid = await readRunnerPid(localRunnerId);
    if (existingPid && isProcessAlive(existingPid)) {
        return {
            localRunnerId,
            pid: existingPid,
            alreadyRunning: true,
            logPath: runnerPaths.logPath,
        };
    }

    if (existingPid && !isProcessAlive(existingPid)) {
        await clearRunnerPid(localRunnerId);
    }

    const entryScriptPath = path.join(resolveRepoRoot(), 'cli-runner', 'runner', 'index.ts');
    const loadedEnv = await loadLocalRunnerEnv();
    const pid = startDetachedRunnerProcess({
        entryScriptPath,
        workingDirectory: resolveRepoRoot(),
        logPath: runnerPaths.logPath,
        env: {
            ...loadedEnv,
            ...process.env,
            RUNNER_CONTROL_PLANE_URL: metadata.controlPlaneBaseUrl,
            RUNNER_VERSION: DEFAULT_RUNNER_VERSION,
            RUNNER_LABEL: metadata.label,
            RUNNER_TOKEN: credential.runnerToken,
            SKYTEST_RUNNER_STATE_DIR: runnerPaths.runtimeStateDir,
            SKYTEST_RUNNER_DISABLE_KEYCHAIN: '1',
            SKYTEST_RUNNER_QUIET: '1',
        },
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
    };
}

export async function stopRunner(localRunnerId: string): Promise<{ localRunnerId: string; stopped: boolean; pid: number | null }> {
    const metadata = await requireRunnerMetadata(localRunnerId);
    const pid = await readRunnerPid(localRunnerId);

    if (!pid) {
        return {
            localRunnerId,
            stopped: false,
            pid: null,
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
    };
}

export async function getRunners(): Promise<LocalRunnerDescriptor[]> {
    const localRunnerIds = await listLocalRunnerIds();
    const descriptors: LocalRunnerDescriptor[] = [];

    for (const localRunnerId of localRunnerIds) {
        if (await isRunnerCredentialRevoked(localRunnerId)) {
            try {
                await stopRunner(localRunnerId);
            } catch {
            }
            await deleteRunner(localRunnerId);
            continue;
        }

        const metadata = await readRunnerMetadata(localRunnerId);
        const credential = await readRunnerCredential(localRunnerId);
        if (!metadata || !credential) {
            continue;
        }

        const runtime = await determineRunnerStatus(localRunnerId);
        descriptors.push({
            metadata,
            credential,
            pid: runtime.pid,
            status: runtime.status,
            logPath: resolveRunnerPaths(localRunnerId).logPath,
        });
    }

    return descriptors;
}

export async function describeRunner(localRunnerId: string): Promise<LocalRunnerDescriptor & { maskedRunnerToken: string }> {
    const metadata = await requireRunnerMetadata(localRunnerId);
    const credential = await requireRunnerCredential(localRunnerId);
    const runtime = await determineRunnerStatus(localRunnerId);

    return {
        metadata,
        credential,
        pid: runtime.pid,
        status: runtime.status,
        logPath: resolveRunnerPaths(localRunnerId).logPath,
        maskedRunnerToken: maskRunnerToken(credential.runnerToken),
    };
}

export async function unpairRunner(localRunnerId: string): Promise<{ localRunnerId: string; removed: boolean }> {
    const metadata = await readRunnerMetadata(localRunnerId);
    if (!metadata) {
        return { localRunnerId, removed: false };
    }

    await stopRunner(localRunnerId);
    await deleteRunner(localRunnerId);
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

export async function readRunnerLog(localRunnerId: string): Promise<string> {
    await requireRunnerMetadata(localRunnerId);
    const logPath = resolveRunnerPaths(localRunnerId).logPath;
    try {
        return await readFile(logPath, 'utf8');
    } catch {
        return '';
    }
}
