import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocalRunnerCredential, LocalRunnerMetadata, LocalRunnerPaths } from './types';

const STATE_DIR_ENV = 'SKYTEST_STATE_DIR';
const DEFAULT_STATE_DIRNAME = '.skytest-dev';
const RUNNERS_DIRNAME = 'runners';
const RUNNER_METADATA_FILE = 'runner.json';
const RUNNER_CREDENTIAL_FILE = 'credential.json';
const RUNNER_PID_STATE_FILE = 'runner.pid.json';
const RUNNER_LOG_FILE = 'runner.log';
const RUNNER_RUNTIME_DIR = 'runtime';

export interface LocalRunnerPidState {
    pid: number;
    processStartedAt: string | null;
}

function resolveRepoRoot(): string {
    const filePath = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(filePath), '../../../..');
}

export function resolveStateRoot(): string {
    const configured = process.env[STATE_DIR_ENV]?.trim();
    if (configured && configured.length > 0) {
        return path.resolve(configured);
    }
    return path.join(resolveRepoRoot(), DEFAULT_STATE_DIRNAME);
}

async function ensureStateRoot(): Promise<void> {
    await mkdir(path.join(resolveStateRoot(), RUNNERS_DIRNAME), { recursive: true });
}

export function resolveRunnerPaths(localRunnerId: string): LocalRunnerPaths {
    const runnerDir = path.join(resolveStateRoot(), RUNNERS_DIRNAME, localRunnerId);
    const runtimeStateDir = path.join(runnerDir, RUNNER_RUNTIME_DIR);

    return {
        runnerDir,
        runtimeStateDir,
        metadataPath: path.join(runnerDir, RUNNER_METADATA_FILE),
        credentialPath: path.join(runnerDir, RUNNER_CREDENTIAL_FILE),
        logPath: path.join(runnerDir, RUNNER_LOG_FILE),
    };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
        const content = await readFile(filePath, 'utf8');
        return JSON.parse(content) as T;
    } catch {
        return null;
    }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
    await rename(tempPath, filePath);
}

export async function listLocalRunnerIds(): Promise<string[]> {
    await ensureStateRoot();
    const runnersDir = path.join(resolveStateRoot(), RUNNERS_DIRNAME);
    const entries = await readdir(runnersDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

export async function readRunnerMetadata(localRunnerId: string): Promise<LocalRunnerMetadata | null> {
    return readJsonFile<LocalRunnerMetadata>(resolveRunnerPaths(localRunnerId).metadataPath);
}

export async function readRunnerCredential(localRunnerId: string): Promise<LocalRunnerCredential | null> {
    return readJsonFile<LocalRunnerCredential>(resolveRunnerPaths(localRunnerId).credentialPath);
}

export async function saveRunnerMetadata(localRunnerId: string, metadata: LocalRunnerMetadata): Promise<void> {
    await writeJsonFile(resolveRunnerPaths(localRunnerId).metadataPath, metadata);
}

export async function saveRunnerCredential(localRunnerId: string, credential: LocalRunnerCredential): Promise<void> {
    await writeJsonFile(resolveRunnerPaths(localRunnerId).credentialPath, credential);
}

export async function ensureRunnerDirectories(localRunnerId: string): Promise<void> {
    const runnerPaths = resolveRunnerPaths(localRunnerId);
    await mkdir(runnerPaths.runnerDir, { recursive: true });
    await mkdir(runnerPaths.runtimeStateDir, { recursive: true });
}

export async function readRunnerPidState(localRunnerId: string): Promise<LocalRunnerPidState | null> {
    const runnerPaths = resolveRunnerPaths(localRunnerId);
    const stateFromJson = await readJsonFile<{
        pid?: unknown;
        processStartedAt?: unknown;
    }>(path.join(runnerPaths.runnerDir, RUNNER_PID_STATE_FILE));
    if (stateFromJson) {
        const pid = typeof stateFromJson.pid === 'number' ? stateFromJson.pid : null;
        if (pid && Number.isInteger(pid) && pid > 0) {
            return {
                pid,
                processStartedAt: typeof stateFromJson.processStartedAt === 'string'
                    ? stateFromJson.processStartedAt
                    : null,
            };
        }
    }
    return null;
}

export async function writeRunnerPid(
    localRunnerId: string,
    pid: number,
    options?: { processStartedAt?: string | null }
): Promise<void> {
    await ensureRunnerDirectories(localRunnerId);
    const runnerPaths = resolveRunnerPaths(localRunnerId);
    await writeJsonFile(path.join(runnerPaths.runnerDir, RUNNER_PID_STATE_FILE), {
        pid,
        processStartedAt: options?.processStartedAt ?? null,
    } satisfies LocalRunnerPidState);
}

export async function clearRunnerPid(localRunnerId: string): Promise<void> {
    const runnerPaths = resolveRunnerPaths(localRunnerId);
    await rm(path.join(runnerPaths.runnerDir, RUNNER_PID_STATE_FILE), { force: true });
}

export async function deleteRunner(localRunnerId: string): Promise<void> {
    await rm(resolveRunnerPaths(localRunnerId).runnerDir, { recursive: true, force: true });
}

export async function clearStateRoot(): Promise<void> {
    await rm(resolveStateRoot(), { recursive: true, force: true });
}
