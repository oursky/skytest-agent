import {
    RUNNER_PROTOCOL_CURRENT_VERSION,
    claimJobResponseSchema,
    completeRunRequestSchema,
    completeRunResponseSchema,
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
    type RunnerEventInput,
    type RunnerTransportMetadata,
} from '@skytest/runner-protocol';
import { createLogger } from '../../src/lib/core/logger';
import { runTest } from '../../src/lib/runtime/test-runner';
import { androidDeviceManager } from '../../src/lib/android/device-manager';
import { formatAndroidDeviceDisplayName, type ConnectedAndroidDeviceInfo } from '../../src/lib/android/device-display';
import { listAndroidDeviceInventory } from '../../src/lib/android/devices';
import type { BrowserConfig, TargetConfig, TestCaseFile, TestStep } from '../../src/types';
import { loadStoredRunnerCredential, saveRunnerCredential, type StoredRunnerCredential } from './credential-store';

const logger = createLogger('runner:macos');
const runnerVersion = process.env.RUNNER_VERSION ?? '0.1.0';
const controlPlaneBaseUrl = process.env.RUNNER_CONTROL_PLANE_URL ?? 'http://127.0.0.1:3000';
const pairingToken = process.env.RUNNER_PAIRING_TOKEN?.trim() || null;
const envRunnerToken = process.env.RUNNER_TOKEN?.trim() || null;
const runnerLabel = process.env.RUNNER_LABEL ?? 'macOS Runner';
const capabilities = ['ANDROID'] as const;

const DEFAULT_TRANSPORT: RunnerTransportMetadata = {
    heartbeatIntervalSeconds: 10,
    claimLongPollTimeoutSeconds: 15,
    deviceSyncIntervalSeconds: 20,
};

const JSON_HEADERS = {
    'Content-Type': 'application/json',
};

interface RunnerAuthState {
    runnerToken: string;
    runnerId?: string;
    credentialExpiresAt?: string;
    transport: RunnerTransportMetadata;
}

interface JobDetailsConfig {
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    openRouterApiKey: string;
    files: TestCaseFile[];
    resolvedVariables: Record<string, string>;
    resolvedFiles: Record<string, string>;
}

interface JobDetailsPayload {
    runId: string;
    testCaseId: string;
    projectId: string;
    config: JobDetailsConfig;
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

let authState: RunnerAuthState | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let deviceSyncTimer: NodeJS.Timeout | null = null;
let stopped = false;

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

async function postRunnerApi<T>(path: string, body: unknown, authenticated = true): Promise<T> {
    const headers: Record<string, string> = { ...JSON_HEADERS };
    if (authenticated) {
        headers.Authorization = `Bearer ${ensureRunnerToken()}`;
    }

    const response = await fetch(new URL(path, controlPlaneBaseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const text = await response.text();
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

async function sendHeartbeat() {
    const payload = heartbeatRunnerRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
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

function mapDeviceState(device: ConnectedAndroidDeviceInfo): 'ONLINE' | 'OFFLINE' | 'UNAVAILABLE' {
    if (device.adbState === 'device') {
        return 'ONLINE';
    }
    if (device.adbState === 'offline') {
        return 'OFFLINE';
    }
    return 'UNAVAILABLE';
}

async function syncDevices() {
    const inventory = await listAndroidDeviceInventory();
    const devices = inventory.connectedDevices.map((device) => ({
        deviceId: device.serial,
        platform: 'ANDROID' as const,
        name: formatAndroidDeviceDisplayName(device),
        state: mapDeviceState(device),
        metadata: {
            adbState: device.adbState,
            kind: device.kind,
            manufacturer: device.manufacturer,
            model: device.model,
            androidVersion: device.androidVersion,
            apiLevel: device.apiLevel,
            emulatorProfileName: device.emulatorProfileName,
            adbProduct: device.adbProduct,
            adbModel: device.adbModel,
            adbDevice: device.adbDevice,
            transportId: device.transportId,
            usb: device.usb,
        },
    }));

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

async function markRunComplete(runId: string, result?: string) {
    const payload = completeRunRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
        result,
    });
    const response = await postRunnerApi(`/api/runners/v1/jobs/${runId}/complete`, payload);
    completeRunResponseSchema.parse(response);
}

async function markRunFailed(runId: string, error: string, result?: string) {
    const payload = failRunRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
        error,
        result,
    });
    const response = await postRunnerApi(`/api/runners/v1/jobs/${runId}/fail`, payload);
    completeRunResponseSchema.parse(response);
}

async function executeClaimedRun(runId: string) {
    const details = await loadJobDetails(runId);
    const queuedEvents: RunnerEventInput[] = [];
    let flushingEvents = false;

    const flushEvents = async () => {
        if (flushingEvents || queuedEvents.length === 0) {
            return;
        }

        flushingEvents = true;
        try {
            while (queuedEvents.length > 0) {
                const batch = queuedEvents.splice(0, 50);
                await postRunEvents(runId, batch);
            }
        } finally {
            flushingEvents = false;
        }
    };

    const queueEvent = (event: RunnerEventInput) => {
        queuedEvents.push(event);
        void flushEvents();
    };

    try {
        const result = await runTest({
            runId,
            config: {
                url: details.config.url,
                prompt: details.config.prompt,
                steps: details.config.steps,
                browserConfig: details.config.browserConfig,
                openRouterApiKey: details.config.openRouterApiKey,
                testCaseId: details.testCaseId,
                projectId: details.projectId,
                files: details.config.files,
                resolvedVariables: details.config.resolvedVariables,
                resolvedFiles: details.config.resolvedFiles,
            },
            onEvent(event) {
                queueEvent({
                    kind: event.type.toUpperCase(),
                    message: event.type === 'log' && 'message' in event.data ? event.data.message : undefined,
                    payload: event,
                });
            },
            async onPreparing() {
                queueEvent({
                    kind: 'STATUS',
                    message: 'Preparing run execution',
                });
            },
            async onRunning() {
                queueEvent({
                    kind: 'STATUS',
                    message: 'Running test steps',
                });
            },
        });

        await flushEvents();

        const resultSummary = JSON.stringify(result);
        if (result.status === 'PASS') {
            await markRunComplete(runId, resultSummary);
            return;
        }

        await markRunFailed(runId, result.error ?? 'Run failed', resultSummary);
    } catch (error) {
        await flushEvents();
        const message = error instanceof Error ? error.message : String(error);
        await markRunFailed(runId, message);
    }
}

function startHeartbeatLoop() {
    const intervalMs = (authState?.transport.heartbeatIntervalSeconds ?? DEFAULT_TRANSPORT.heartbeatIntervalSeconds) * 1000;
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
    }
    heartbeatTimer = setInterval(() => {
        void sendHeartbeat().catch((error) => {
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
            logger.error('Device sync failed', error);
        });
    }, intervalMs);
}

async function start() {
    await bootstrapRunnerCredential();

    try {
        await registerRunner();
    } catch (error) {
        if (error instanceof RunnerHttpError && error.status === 401 && pairingToken) {
            authState = await exchangePairingCredential();
            await registerRunner();
        } else {
            throw error;
        }
    }

    await androidDeviceManager.initialize();
    await syncDevices();

    startHeartbeatLoop();
    startDeviceSyncLoop();

    while (!stopped) {
        try {
            const job = await claimJob();
            if (!job) {
                continue;
            }

            logger.info('Claimed Android run', { runId: job.runId, requestedDeviceId: job.requestedDeviceId });
            await executeClaimedRun(job.runId);
        } catch (error) {
            logger.error('Runner loop failed', error);
            await new Promise((resolve) => setTimeout(resolve, 3000));
        }
    }
}

function registerSignalHandlers() {
    const handleStop = (signal: string) => {
        logger.info(`Stopping runner due to ${signal}`);
        stopped = true;
        stopBackgroundLoops();
    };

    process.on('SIGINT', () => handleStop('SIGINT'));
    process.on('SIGTERM', () => handleStop('SIGTERM'));
}

registerSignalHandlers();

void start().catch((error) => {
    stopBackgroundLoops();
    logger.error('Runner failed to start', error);
    process.exitCode = 1;
});
