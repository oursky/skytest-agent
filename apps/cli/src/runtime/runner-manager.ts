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
import { exchangePairingToken, notifyRunnerShutdown } from './control-plane';
import { isProcessAlive, startDetachedRunnerProcess, stopProcessWithTimeout } from './process';

const DEFAULT_CONTROL_PLANE_URL = process.env.RUNNER_CONTROL_PLANE_URL ?? 'http://127.0.0.1:3000';
const DEFAULT_RUNNER_VERSION = process.env.RUNNER_VERSION ?? '0.1.0';
const STOP_TIMEOUT_MS = 5_000;
const RUNNER_CREDENTIAL_REVOKED_FILE = 'credential-revoked.json';
const RUNNER_ENV_FILE_ENV = 'SKYTEST_RUNNER_ENV_FILE';
type RunnerEnv = Record<string, string | undefined>;

function resolveRepoRoot(): string {
    const currentFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(currentFile), '../../../..');
}

function resolveRunnerEnvFileCandidates(): string[] {
    const configuredEnvFile = process.env[RUNNER_ENV_FILE_ENV]?.trim();
    const env = process.env.NODE_ENV ?? 'development';
    const repoRoot = resolveRepoRoot();
    const defaultUserEnvFile = path.join(os.homedir(), '.config', 'skytest', 'runner.env');
    const candidates = [
        configuredEnvFile ? path.resolve(configuredEnvFile) : null,
        defaultUserEnvFile,
        path.join(repoRoot, '.env'),
        path.join(repoRoot, '.env.local'),
        path.join(repoRoot, `.env.${env}`),
        path.join(repoRoot, `.env.${env}.local`),
    ].filter((item): item is string => Boolean(item));

    return Array.from(new Set(candidates));
}

function resolveMidsceneDefaultEnv(): RunnerEnv {
    return {
        MIDSCENE_MODEL_BASE_URL: 'https://openrouter.ai/api/v1',
        MIDSCENE_MODEL_NAME: 'bytedance-seed/seed-1.6-flash',
        MIDSCENE_MODEL_FAMILY: 'doubao-vision',
        MIDSCENE_PLANNING_MODEL_BASE_URL: 'https://openrouter.ai/api/v1',
        MIDSCENE_PLANNING_MODEL_NAME: 'qwen/qwen3.5-35b-a3b',
        MIDSCENE_PLANNING_MODEL_FAMILY: 'qwen3.5',
        MIDSCENE_INSIGHT_MODEL_BASE_URL: 'https://openrouter.ai/api/v1',
        MIDSCENE_INSIGHT_MODEL_NAME: 'qwen/qwen3.5-35b-a3b',
        MIDSCENE_INSIGHT_MODEL_FAMILY: 'qwen3.5',
        MIDSCENE_MODEL_TEMPERATURE: '0.2',
    };
}

async function loadLocalRunnerEnv(): Promise<RunnerEnv> {
    const files = resolveRunnerEnvFileCandidates();
    const result: RunnerEnv = {
        ...resolveMidsceneDefaultEnv(),
    };

    for (const filePath of files) {
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

    return {
        ...result,
        MIDSCENE_MODEL_BASE_URL: process.env.SKYTEST_MIDSCENE_MODEL_BASE_URL?.trim() || result.MIDSCENE_MODEL_BASE_URL,
        MIDSCENE_MODEL_NAME: process.env.SKYTEST_MIDSCENE_MODEL_NAME?.trim() || result.MIDSCENE_MODEL_NAME,
        MIDSCENE_MODEL_FAMILY: process.env.SKYTEST_MIDSCENE_MODEL_FAMILY?.trim() || result.MIDSCENE_MODEL_FAMILY,
        MIDSCENE_PLANNING_MODEL_BASE_URL: process.env.SKYTEST_MIDSCENE_PLANNING_MODEL_BASE_URL?.trim() || result.MIDSCENE_PLANNING_MODEL_BASE_URL,
        MIDSCENE_PLANNING_MODEL_NAME: process.env.SKYTEST_MIDSCENE_PLANNING_MODEL_NAME?.trim() || result.MIDSCENE_PLANNING_MODEL_NAME,
        MIDSCENE_PLANNING_MODEL_FAMILY: process.env.SKYTEST_MIDSCENE_PLANNING_MODEL_FAMILY?.trim() || result.MIDSCENE_PLANNING_MODEL_FAMILY,
        MIDSCENE_INSIGHT_MODEL_BASE_URL: process.env.SKYTEST_MIDSCENE_INSIGHT_MODEL_BASE_URL?.trim() || result.MIDSCENE_INSIGHT_MODEL_BASE_URL,
        MIDSCENE_INSIGHT_MODEL_NAME: process.env.SKYTEST_MIDSCENE_INSIGHT_MODEL_NAME?.trim() || result.MIDSCENE_INSIGHT_MODEL_NAME,
        MIDSCENE_INSIGHT_MODEL_FAMILY: process.env.SKYTEST_MIDSCENE_INSIGHT_MODEL_FAMILY?.trim() || result.MIDSCENE_INSIGHT_MODEL_FAMILY,
        MIDSCENE_MODEL_TEMPERATURE: process.env.SKYTEST_MIDSCENE_MODEL_TEMPERATURE?.trim() || result.MIDSCENE_MODEL_TEMPERATURE,
    };
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
}

export async function startRunner(runnerIdentifier: string): Promise<StartRunnerResult> {
    const localRunnerId = await resolveLocalRunnerId(runnerIdentifier);
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

    const entryScriptPath = path.join(resolveRepoRoot(), 'apps', 'macos-runner', 'runner', 'index.ts');
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
            TSX_TSCONFIG_PATH: path.join(resolveRepoRoot(), 'apps', 'web', 'tsconfig.json'),
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

export async function describeRunner(runnerIdentifier: string): Promise<LocalRunnerDescriptor & { maskedRunnerToken: string }> {
    const localRunnerId = await resolveLocalRunnerId(runnerIdentifier);
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
