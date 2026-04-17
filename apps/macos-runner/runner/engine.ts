import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    RUNNER_DEFAULT_CAPABILITIES,
    RUNNER_DEFAULT_TRANSPORT,
    RUNNER_MINIMUM_VERSION,
    RUNNER_PROTOCOL_CURRENT_VERSION,
    claimJobResponseSchema,
    completeRunRequestSchema,
    runCompletionResponseSchema,
    deviceSyncRequestSchema,
    deviceSyncResponseSchema,
    failRunRequestSchema,
    heartbeatRunnerRequestSchema,
    heartbeatRunnerResponseSchema,
    ingestEventsRequestSchema,
    ingestEventsResponseSchema,
    jobDetailsRequestSchema,
    jobDetailsResponseSchema,
    pairingExchangeRequestSchema,
    pairingExchangeResponseSchema,
    registerRunnerRequestSchema,
    registerRunnerResponseSchema,
    uploadArtifactRequestSchema,
    uploadArtifactResponseSchema,
    resolveHostFingerprint,
    type RunnerEventInput,
    type RunnerTransportMetadata,
} from '@skytest/runner-protocol';
import * as loggerModule from '../../web/src/lib/core/logger';
import * as devicesModule from '../../web/src/lib/android/devices';
import type { BrowserConfig, TargetConfig, TestCaseFile, TestStep } from '../../web/src/types';
import { loadStoredRunnerCredential, saveRunnerCredential, type StoredRunnerCredential } from './credential-store';
import { buildDeviceSyncPayload } from './device-sync';
import { acquireRunnerProcessLock } from './process-lock';
import { executeClaimedRun, type JobDetailsPayload } from './run-execution';
import { buildRunnerDisplayId, sleep } from './runtime-utils';

type CreateLoggerFn = typeof import('../../web/src/lib/core/logger').createLogger;
type ListAndroidDeviceInventoryFn = typeof import('../../web/src/lib/android/devices').listAndroidDeviceInventory;

function resolveModuleExport<T>(module: Record<string, unknown>, key: string): T | null {
    if (key in module) {
        return module[key] as T;
    }

    const defaultExport = module.default;
    if (typeof defaultExport === 'object' && defaultExport !== null && key in defaultExport) {
        return (defaultExport as Record<string, unknown>)[key] as T;
    }

    return null;
}

function requireModuleExport<T>(module: Record<string, unknown>, key: string, source: string): T {
    const value = resolveModuleExport<T>(module, key);
    if (!value) {
        throw new Error(`Failed to load ${key} from ${source}`);
    }
    return value;
}

const createLogger = requireModuleExport<CreateLoggerFn>(
    loggerModule as unknown as Record<string, unknown>,
    'createLogger',
    '../../web/src/lib/core/logger'
);
const listAndroidDeviceInventory = requireModuleExport<ListAndroidDeviceInventoryFn>(
    devicesModule as unknown as Record<string, unknown>,
    'listAndroidDeviceInventory',
    '../../web/src/lib/android/devices'
);
type RunnerLogger = ReturnType<CreateLoggerFn>;
const baseLogger = createLogger('runner:macos-runner');
const quietMode = process.env.SKYTEST_RUNNER_QUIET === '1';
const logger: RunnerLogger = quietMode
    ? {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: (message: string, meta?: unknown) => baseLogger.error(message, meta),
    }
    : baseLogger;
const runnerVersion = process.env.RUNNER_VERSION ?? RUNNER_MINIMUM_VERSION;
const controlPlaneBaseUrl = process.env.RUNNER_CONTROL_PLANE_URL ?? 'http://127.0.0.1:3000';
const pairingToken = process.env.RUNNER_PAIRING_TOKEN?.trim() || null;
const envRunnerToken = process.env.RUNNER_TOKEN?.trim() || null;
const runnerLabel = process.env.RUNNER_LABEL ?? 'macOS Runner';
const runnerDisplayId = (process.env.RUNNER_DISPLAY_ID?.trim() || '').toLowerCase();
const capabilities = [...RUNNER_DEFAULT_CAPABILITIES];
const runnerStateRoot = process.env.SKYTEST_RUNNER_STATE_DIR?.trim() || path.join(os.homedir(), '.skytest-agent');
const RUNNER_LOCK_PATH = path.join(runnerStateRoot, 'runner.lock');
const RUNNER_CREDENTIAL_REVOKED_PATH = path.join(runnerStateRoot, 'credential-revoked.json');
const DEFAULT_TRANSPORT: RunnerTransportMetadata = RUNNER_DEFAULT_TRANSPORT;
const hostFingerprint = resolveHostFingerprint(process.env.RUNNER_HOST_FINGERPRINT);
const JSON_HEADERS = {
    'Content-Type': 'application/json',
};

interface RunnerAuthState {
    runnerToken: string;
    runnerId?: string;
    credentialExpiresAt?: string;
    transport: RunnerTransportMetadata;
}

interface AndroidDeviceManagerRuntime {
    initialize(): Promise<void>;
}

class RunnerHttpError extends Error {
    status: number;
    body: string;

    constructor(status: number, body: string) {
        super(`Runner API failed with ${status}: ${body}`);
        this.status = status;
        this.body = body;
    }
}

function isRunOwnershipLostError(error: unknown): boolean {
    return error instanceof RunnerHttpError && error.status === 403;
}

function isRunOwnershipArtifactError(error: unknown): boolean {
    return error instanceof RunnerHttpError
        && (error.status === 400 || error.status === 403)
        && /ownership/i.test(error.body);
}

async function loadAndroidDeviceManager(): Promise<AndroidDeviceManagerRuntime> {
    const deviceManagerModule = await import('../../web/src/lib/android/device-manager');
    const candidate = deviceManagerModule as {
        androidDeviceManager?: AndroidDeviceManagerRuntime;
        default?: { androidDeviceManager?: AndroidDeviceManagerRuntime };
    };

    const manager = candidate.androidDeviceManager ?? candidate.default?.androidDeviceManager;
    if (!manager) {
        throw new Error('Failed to load androidDeviceManager from ../../web/src/lib/android/device-manager');
    }

    return manager;
}

let authState: RunnerAuthState | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let deviceSyncTimer: NodeJS.Timeout | null = null;
let stopped = false;
let credentialRevoked = false;

function stopBackgroundLoops() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    if (deviceSyncTimer) {
        clearInterval(deviceSyncTimer);
        deviceSyncTimer = null;
    }
}

function ensureRunnerToken(): string {
    if (!authState?.runnerToken) {
        throw new Error('Runner credential missing');
    }
    return authState.runnerToken;
}

async function postRunnerApi<T>(endpointPath: string, body: unknown, authenticated = true): Promise<T> {
    const headers: Record<string, string> = { ...JSON_HEADERS };
    if (authenticated) {
        headers.Authorization = `Bearer ${ensureRunnerToken()}`;
    }

    const response = await fetch(new URL(endpointPath, controlPlaneBaseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const text = await response.text();
        if (authenticated && response.status === 401 && !credentialRevoked) {
            credentialRevoked = true;
            await mkdir(path.dirname(RUNNER_CREDENTIAL_REVOKED_PATH), { recursive: true });
            await writeFile(RUNNER_CREDENTIAL_REVOKED_PATH, JSON.stringify({
                revokedAt: new Date().toISOString(),
                status: response.status,
                path: endpointPath,
                body: text,
            }), 'utf8');
            requestRunnerStop('Runner credential unauthorized. Local runner will stop and require re-pair.');
        }
        throw new RunnerHttpError(response.status, text);
    }

    return response.json() as Promise<T>;
}

async function exchangePairingCredential(): Promise<RunnerAuthState> {
    if (!pairingToken) {
        throw new Error('RUNNER_PAIRING_TOKEN is required to provision a new runner credential');
    }

    const payload = pairingExchangeRequestSchema.parse({
        pairingToken,
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
        hostFingerprint,
        displayId: runnerDisplayId || buildRunnerDisplayId(`${runnerLabel}:${os.hostname()}:${runnerVersion}`),
        label: runnerLabel,
        kind: 'MACOS_AGENT',
        capabilities,
    });
    const response = await postRunnerApi('/api/runners/v1/pairing/exchange', payload, false);
    const parsed = pairingExchangeResponseSchema.parse(response);

    const nextState: RunnerAuthState = {
        runnerToken: parsed.runnerToken,
        runnerId: parsed.runnerId,
        credentialExpiresAt: parsed.credentialExpiresAt,
        transport: parsed.transport,
    };

    const credential: StoredRunnerCredential = {
        runnerToken: parsed.runnerToken,
        runnerId: parsed.runnerId,
        credentialExpiresAt: parsed.credentialExpiresAt,
        updatedAt: new Date().toISOString(),
    };
    await saveRunnerCredential(controlPlaneBaseUrl, credential);

    return nextState;
}

async function bootstrapRunnerCredential(): Promise<void> {
    if (envRunnerToken) {
        authState = {
            runnerToken: envRunnerToken,
            transport: DEFAULT_TRANSPORT,
        };
        return;
    }

    const stored = await loadStoredRunnerCredential(controlPlaneBaseUrl);
    if (stored?.runnerToken) {
        authState = {
            runnerToken: stored.runnerToken,
            runnerId: stored.runnerId,
            credentialExpiresAt: stored.credentialExpiresAt,
            transport: DEFAULT_TRANSPORT,
        };
        return;
    }

    authState = await exchangePairingCredential();
}

async function registerRunner(): Promise<void> {
    const payload = registerRunnerRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
        hostFingerprint,
        label: runnerLabel,
        kind: 'MACOS_AGENT',
        capabilities,
    });
    const response = await postRunnerApi('/api/runners/v1/register', payload);
    const parsed = registerRunnerResponseSchema.parse(response);

    authState = {
        runnerToken: ensureRunnerToken(),
        runnerId: parsed.runnerId,
        credentialExpiresAt: parsed.credentialExpiresAt,
        transport: parsed.transport,
    };

    await saveRunnerCredential(controlPlaneBaseUrl, {
        runnerToken: ensureRunnerToken(),
        runnerId: parsed.runnerId,
        credentialExpiresAt: parsed.credentialExpiresAt,
        updatedAt: new Date().toISOString(),
    });
}

async function repairRunnerRegistration(): Promise<void> {
    const payload = registerRunnerRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
        hostFingerprint,
        label: runnerLabel,
        kind: 'MACOS_AGENT',
        capabilities,
    });
    const response = await postRunnerApi('/api/runners/v1/repair', payload);
    const parsed = registerRunnerResponseSchema.parse(response);

    authState = {
        runnerToken: ensureRunnerToken(),
        runnerId: parsed.runnerId,
        credentialExpiresAt: parsed.credentialExpiresAt,
        transport: parsed.transport,
    };

    await saveRunnerCredential(controlPlaneBaseUrl, {
        runnerToken: ensureRunnerToken(),
        runnerId: parsed.runnerId,
        credentialExpiresAt: parsed.credentialExpiresAt,
        updatedAt: new Date().toISOString(),
    });
}

async function sendHeartbeat() {
    const payload = heartbeatRunnerRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
        hostFingerprint,
    });
    const response = await postRunnerApi('/api/runners/v1/heartbeat', payload);
    const parsed = heartbeatRunnerResponseSchema.parse(response);

    authState = {
        runnerToken: ensureRunnerToken(),
        runnerId: parsed.runnerId,
        credentialExpiresAt: parsed.credentialExpiresAt,
        transport: parsed.transport,
    };

    if (parsed.rotationRequired) {
        logger.warn('Runner credential rotation required');
    }
}

async function syncDevices() {
    const inventory = await listAndroidDeviceInventory();
    const devices = buildDeviceSyncPayload(inventory);
    const payload = deviceSyncRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
        devices,
    });
    const response = await postRunnerApi('/api/runners/v1/devices/sync', payload);
    const parsed = deviceSyncResponseSchema.parse(response);

    if (parsed.rotationRequired) {
        logger.warn('Runner credential rotation required');
    }
}

async function claimJob() {
    const response = await postRunnerApi('/api/runners/v1/jobs/claim', {
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
    });
    const parsed = claimJobResponseSchema.parse(response);

    if (parsed.rotationRequired) {
        logger.warn('Runner credential rotation required');
    }

    return parsed.job;
}

async function loadJobDetails(runId: string): Promise<JobDetailsPayload> {
    const payload = jobDetailsRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
    });
    const response = await postRunnerApi(`/api/runners/v1/jobs/${runId}/details`, payload);
    const parsed = jobDetailsResponseSchema.parse(response);

    return {
        runId: parsed.runId,
        testCaseId: parsed.testCaseId,
        projectId: parsed.projectId,
        config: {
            url: parsed.config.url,
            prompt: parsed.config.prompt,
            steps: parsed.config.steps as TestStep[] | undefined,
            browserConfig: parsed.config.browserConfig as Record<string, BrowserConfig | TargetConfig> | undefined,
            openRouterApiKey: parsed.config.openRouterApiKey,
            aiProvider: parsed.config.aiProvider,
            midsceneModelOptions: parsed.config.midsceneModelOptions,
            files: parsed.config.files as TestCaseFile[],
            resolvedVariables: parsed.config.resolvedVariables,
            resolvedFiles: parsed.config.resolvedFiles,
        },
    };
}

async function postRunEvents(runId: string, events: RunnerEventInput[]) {
    if (events.length === 0) {
        return;
    }

    const payload = ingestEventsRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
        events,
    });

    const response = await postRunnerApi(`/api/runners/v1/jobs/${runId}/events`, payload);
    ingestEventsResponseSchema.parse(response);
}

async function uploadRunArtifact(runId: string, input: {
    filename: string;
    mimeType: string;
    contentBase64: string;
}) {
    const payload = uploadArtifactRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
        filename: input.filename,
        mimeType: input.mimeType,
        contentBase64: input.contentBase64,
    });
    const response = await postRunnerApi(`/api/runners/v1/jobs/${runId}/artifacts`, payload);
    return uploadArtifactResponseSchema.parse(response);
}

async function markRunComplete(runId: string, result?: string) {
    const payload = completeRunRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
        result,
    });
    const response = await postRunnerApi(`/api/runners/v1/jobs/${runId}/complete`, payload);
    runCompletionResponseSchema.parse(response);
}

async function markRunFailed(runId: string, error: string, result?: string) {
    const payload = failRunRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
        error,
        result,
    });
    const response = await postRunnerApi(`/api/runners/v1/jobs/${runId}/fail`, payload);
    runCompletionResponseSchema.parse(response);
}

async function executeClaimedRunJob(runId: string) {
    await executeClaimedRun({
        runId,
        api: {
            loadJobDetails,
            postRunEvents,
            uploadRunArtifact,
            markRunComplete,
            markRunFailed,
        },
        logger,
        isRunOwnershipLostError,
        isRunOwnershipArtifactError,
    });
}

function startHeartbeatLoop() {
    const intervalMs = (authState?.transport.heartbeatIntervalSeconds ?? DEFAULT_TRANSPORT.heartbeatIntervalSeconds) * 1000;
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
    }
    heartbeatTimer = setInterval(() => {
        void sendHeartbeat().catch((error) => {
            if (stopped) {
                return;
            }
            logger.error('Heartbeat failed', error);
        });
    }, intervalMs);
}

function startDeviceSyncLoop() {
    const intervalMs = (authState?.transport.deviceSyncIntervalSeconds ?? DEFAULT_TRANSPORT.deviceSyncIntervalSeconds) * 1000;
    if (deviceSyncTimer) {
        clearInterval(deviceSyncTimer);
    }
    deviceSyncTimer = setInterval(() => {
        void syncDevices().catch((error) => {
            if (stopped) {
                return;
            }
            logger.error('Device sync failed', error);
        });
    }, intervalMs);
}

export function requestRunnerStop(reason?: string): void {
    if (stopped) {
        return;
    }
    if (reason) {
        logger.info(reason);
    }
    stopped = true;
    stopBackgroundLoops();
}

export async function startRunnerEngine() {
    stopped = false;
    const releaseLock = await acquireRunnerProcessLock({
        lockPath: RUNNER_LOCK_PATH,
        controlPlaneBaseUrl,
        runnerLabel,
    });

    try {
        try {
            await bootstrapRunnerCredential();

            await registerRunner();
        } catch (error) {
            if (error instanceof RunnerHttpError && error.status === 401 && pairingToken) {
                authState = await exchangePairingCredential();
                await registerRunner();
            } else if (error instanceof RunnerHttpError && error.status === 409) {
                logger.warn('Runner host fingerprint mismatch detected. Repairing runner registration.');
                await repairRunnerRegistration();
            } else {
                throw error;
            }
        }

        const androidDeviceManager = await loadAndroidDeviceManager();
        await androidDeviceManager.initialize();
        await syncDevices();

        startHeartbeatLoop();
        startDeviceSyncLoop();

        while (!stopped) {
            try {
                const job = await claimJob();
                if (stopped) {
                    break;
                }
                if (!job) {
                    await sleep(150 + Math.floor(Math.random() * 300));
                    continue;
                }

                logger.info('Claimed Android run', { runId: job.runId, requestedDeviceId: job.requestedDeviceId });
                await executeClaimedRunJob(job.runId);
            } catch (error) {
                if (stopped) {
                    break;
                }
                logger.error('Runner loop failed', error);
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
        }
    } finally {
        await releaseLock();
    }
}
