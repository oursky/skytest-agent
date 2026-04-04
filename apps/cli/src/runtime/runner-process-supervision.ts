import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { RUNNER_MINIMUM_VERSION, resolveHostFingerprint } from '@skytest/runner-protocol';
import type { LocalRunnerCredential, LocalRunnerMetadata } from '../state/types';
import { isProcessAlive, startDetachedRunnerProcess } from './process';

const DEFAULT_RUNNER_VERSION = process.env.RUNNER_VERSION ?? RUNNER_MINIMUM_VERSION;
const STARTUP_HEALTH_CHECK_MS = 500;
const RUNNER_ENV_FILE_ENV = 'SKYTEST_RUNNER_ENV_FILE';

type RunnerEnv = Record<string, string | undefined>;

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

async function fileExists(pathToCheck: string): Promise<boolean> {
    try {
        await access(pathToCheck);
        return true;
    } catch {
        return false;
    }
}

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
        MIDSCENE_MODEL_NAME: 'google/gemini-3.1-flash-lite-preview',
        MIDSCENE_MODEL_FAMILY: 'gemini',
        MIDSCENE_PLANNING_MODEL_BASE_URL: 'https://openrouter.ai/api/v1',
        MIDSCENE_PLANNING_MODEL_NAME: 'qwen/qwen3.5-27b',
        MIDSCENE_PLANNING_MODEL_FAMILY: 'qwen3.5',
        MIDSCENE_INSIGHT_MODEL_BASE_URL: 'https://openrouter.ai/api/v1',
        MIDSCENE_INSIGHT_MODEL_NAME: 'qwen/qwen3.5-27b',
        MIDSCENE_INSIGHT_MODEL_FAMILY: 'qwen3.5',
        MIDSCENE_MODEL_TEMPERATURE: '0.2',
    };
}

export function resolveManagedMidsceneRunDir(input: {
    runtimeStateDir: string;
    loadedEnv: Record<string, string | undefined>;
}): string {
    const configured = process.env.MIDSCENE_RUN_DIR?.trim() || input.loadedEnv.MIDSCENE_RUN_DIR?.trim();
    if (!configured) {
        return path.join(input.runtimeStateDir, 'midscene');
    }
    if (path.isAbsolute(configured)) {
        return configured;
    }
    return path.join(input.runtimeStateDir, configured);
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

export async function startManagedRunnerProcess(input: {
    localRunnerId: string;
    metadata: LocalRunnerMetadata;
    credential: LocalRunnerCredential;
    runtimeStateDir: string;
    logPath: string;
}): Promise<number> {
    const repoRoot = resolveRepoRoot();
    const bundledEntryScriptPath = path.join(repoRoot, 'apps', 'macos-runner', 'dist', 'runner.bundle.cjs');
    const sourceEntryScriptPath = path.join(repoRoot, 'apps', 'macos-runner', 'runner', 'index.ts');
    const useBundledRunnerEntry = await fileExists(bundledEntryScriptPath);
    const entryScriptPath = useBundledRunnerEntry ? bundledEntryScriptPath : sourceEntryScriptPath;
    const loadedEnv = await loadLocalRunnerEnv();

    const pid = startDetachedRunnerProcess({
        entryScriptPath,
        workingDirectory: repoRoot,
        logPath: input.logPath,
        useTsxLoader: !useBundledRunnerEntry,
        env: {
            ...loadedEnv,
            ...process.env,
            RUNNER_CONTROL_PLANE_URL: input.metadata.controlPlaneBaseUrl,
            RUNNER_VERSION: DEFAULT_RUNNER_VERSION,
            RUNNER_LABEL: input.metadata.label,
            RUNNER_DISPLAY_ID: input.metadata.localRunnerId,
            RUNNER_HOST_FINGERPRINT: resolveHostFingerprint(),
            RUNNER_TOKEN: input.credential.runnerToken,
            SKYTEST_RUNNER_STATE_DIR: input.runtimeStateDir,
            SKYTEST_RUNNER_DISABLE_KEYCHAIN: '1',
            SKYTEST_RUNNER_QUIET: '1',
            MIDSCENE_RUN_DIR: resolveManagedMidsceneRunDir({
                runtimeStateDir: input.runtimeStateDir,
                loadedEnv,
            }),
            ...(useBundledRunnerEntry ? {} : {
                TSX_TSCONFIG_PATH: path.join(repoRoot, 'apps', 'web', 'tsconfig.json'),
            }),
        },
    });

    await sleep(STARTUP_HEALTH_CHECK_MS);
    if (!isProcessAlive(pid)) {
        throw new Error(`Runner process exited before startup completed. Check logs: ${input.logPath}`);
    }

    return pid;
}
