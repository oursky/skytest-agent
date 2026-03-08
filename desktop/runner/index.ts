import { mkdir, open, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
    uploadArtifactRequestSchema,
    uploadArtifactResponseSchema,
    type RunnerEventInput,
    type RunnerTransportMetadata,
} from '@skytest/runner-protocol';
import * as loggerModule from '../../src/lib/core/logger';
import * as testRunnerModule from '../../src/lib/runtime/test-runner';
import * as deviceDisplayModule from '../../src/lib/android/device-display';
import * as devicesModule from '../../src/lib/android/devices';
import * as eventsModule from '../../src/types/events';
import type { ConnectedAndroidDeviceInfo } from '../../src/lib/android/device-display';
import type { BrowserConfig, TargetConfig, TestCaseFile, TestEvent, TestStep } from '../../src/types';
import { loadStoredRunnerCredential, saveRunnerCredential, type StoredRunnerCredential } from './credential-store';

type CreateLoggerFn = typeof import('../../src/lib/core/logger').createLogger;
type RunTestFn = typeof import('../../src/lib/runtime/test-runner').runTest;
type FormatAndroidDeviceDisplayNameFn = typeof import('../../src/lib/android/device-display').formatAndroidDeviceDisplayName;
type ListAndroidDeviceInventoryFn = typeof import('../../src/lib/android/devices').listAndroidDeviceInventory;
type IsScreenshotDataFn = typeof import('../../src/types/events').isScreenshotData;

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
    '../../src/lib/core/logger'
);
const runTest = requireModuleExport<RunTestFn>(
    testRunnerModule as unknown as Record<string, unknown>,
    'runTest',
    '../../src/lib/runtime/test-runner'
);
const formatAndroidDeviceDisplayName = requireModuleExport<FormatAndroidDeviceDisplayNameFn>(
    deviceDisplayModule as unknown as Record<string, unknown>,
    'formatAndroidDeviceDisplayName',
    '../../src/lib/android/device-display'
);
const listAndroidDeviceInventory = requireModuleExport<ListAndroidDeviceInventoryFn>(
    devicesModule as unknown as Record<string, unknown>,
    'listAndroidDeviceInventory',
    '../../src/lib/android/devices'
);
const isScreenshotData = requireModuleExport<IsScreenshotDataFn>(
    eventsModule as unknown as Record<string, unknown>,
    'isScreenshotData',
    '../../src/types/events'
);

const logger = createLogger('runner:macos');
const runnerVersion = process.env.RUNNER_VERSION ?? '0.1.0';
const controlPlaneBaseUrl = process.env.RUNNER_CONTROL_PLANE_URL ?? 'http://127.0.0.1:3000';
const pairingToken = process.env.RUNNER_PAIRING_TOKEN?.trim() || null;
const envRunnerToken = process.env.RUNNER_TOKEN?.trim() || null;
const runnerLabel = process.env.RUNNER_LABEL ?? 'macOS Runner';
const capabilities = ['ANDROID'] as const;
const EMULATOR_PROFILE_DEVICE_PREFIX = 'emulator-profile:';
const RUNNER_LOCK_PATH = path.join(os.homedir(), '.skytest-agent', 'runner.lock');

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

interface ParsedImageDataUrl {
    mimeType: string;
    extension: string;
    contentBase64: string;
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

async function loadAndroidDeviceManager(): Promise<AndroidDeviceManagerRuntime> {
    const deviceManagerModule = await import('../../src/lib/android/device-manager');
    const candidate = deviceManagerModule as {
        androidDeviceManager?: AndroidDeviceManagerRuntime;
        default?: { androidDeviceManager?: AndroidDeviceManagerRuntime };
    };

    const manager = candidate.androidDeviceManager ?? candidate.default?.androidDeviceManager;
    if (!manager) {
        throw new Error('Failed to load androidDeviceManager from ../../src/lib/android/device-manager');
    }

    return manager;
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

function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function tryReadLockPid(): Promise<number | null> {
    try {
        const raw = await readFile(RUNNER_LOCK_PATH, 'utf8');
        const parsed = JSON.parse(raw) as { pid?: unknown };
        return typeof parsed.pid === 'number' ? parsed.pid : null;
    } catch {
        return null;
    }
}

async function acquireRunnerLock(): Promise<() => Promise<void>> {
    await mkdir(path.dirname(RUNNER_LOCK_PATH), { recursive: true });

    const writeLock = async () => {
        const handle = await open(RUNNER_LOCK_PATH, 'wx');
        try {
            await handle.writeFile(JSON.stringify({
                pid: process.pid,
                startedAt: new Date().toISOString(),
                controlPlaneBaseUrl,
                runnerLabel,
            }));
        } finally {
            await handle.close();
        }
    };

    try {
        await writeLock();
    } catch {
        const lockPid = await tryReadLockPid();
        if (!lockPid || !isProcessAlive(lockPid)) {
            await rm(RUNNER_LOCK_PATH, { force: true });
            await writeLock();
        } else {
            throw new Error(`Another macOS runner process is already running (pid ${lockPid})`);
        }
    }

    return async () => {
        await rm(RUNNER_LOCK_PATH, { force: true });
    };
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

function buildEmulatorProfileDeviceId(profileName: string): string {
    return `${EMULATOR_PROFILE_DEVICE_PREFIX}${profileName}`;
}

async function syncDevices() {
    const inventory = await listAndroidDeviceInventory();
    const emulatorDevicesByProfile = new Map(
        inventory.connectedDevices
            .filter((device) => device.kind === 'emulator' && typeof device.emulatorProfileName === 'string' && device.emulatorProfileName.trim().length > 0)
            .map((device) => [device.emulatorProfileName as string, device] as const)
    );

    const connectedDevices = inventory.connectedDevices
        .filter((device) => {
            if (device.kind !== 'emulator') {
                return true;
            }
            if (typeof device.emulatorProfileName !== 'string') {
                return true;
            }
            return device.emulatorProfileName.trim().length === 0;
        })
        .map((device) => ({
        deviceId: device.serial,
        platform: 'ANDROID' as const,
        name: formatAndroidDeviceDisplayName(device),
        state: mapDeviceState(device),
        metadata: {
            inventoryKind: 'connected-device',
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

    const emulatorProfiles = inventory.emulatorProfiles
        .map((profile) => {
            const connected = emulatorDevicesByProfile.get(profile.name);
            const state = connected ? mapDeviceState(connected) : 'OFFLINE';

            return {
            deviceId: buildEmulatorProfileDeviceId(profile.name),
            platform: 'ANDROID' as const,
            name: profile.displayName,
            state,
            metadata: {
                inventoryKind: 'emulator-profile',
                emulatorProfileName: profile.name,
                apiLevel: profile.apiLevel,
                screenSize: profile.screenSize,
                connectedSerial: connected?.serial ?? null,
                adbState: connected?.adbState ?? null,
                manufacturer: connected?.manufacturer ?? null,
                model: connected?.model ?? null,
                androidVersion: connected?.androidVersion ?? null,
            },
            };
        });

    const devices = [...connectedDevices, ...emulatorProfiles];

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

function parseImageDataUrl(value: string): ParsedImageDataUrl | null {
    const match = /^data:([^;]+);base64,(.+)$/i.exec(value.trim());
    if (!match) {
        return null;
    }

    const mimeType = match[1].toLowerCase();
    const contentBase64 = match[2].replace(/\s+/g, '');
    if (!contentBase64) {
        return null;
    }

    const extension = mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/png'
            ? 'png'
            : mimeType === 'image/webp'
                ? 'webp'
                : mimeType === 'image/gif'
                    ? 'gif'
                    : 'bin';

    return {
        mimeType,
        extension,
        contentBase64,
    };
}

function toSafeScreenshotFilename(label: string, extension: string): string {
    const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const base = normalized.length > 0 ? normalized.slice(0, 80) : 'screenshot';
    return `${base}-${Date.now()}.${extension}`;
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
    const pendingArtifactUploads = new Set<Promise<void>>();
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

    const handleTestEvent = (event: TestEvent) => {
        const screenshotData = event.type === 'screenshot' && isScreenshotData(event.data)
            ? event.data
            : null;
        if (screenshotData) {
            const uploadTask = (async () => {
                const parsed = parseImageDataUrl(screenshotData.src);
                if (!parsed) {
                    queueEvent({
                        kind: 'SCREENSHOT',
                        message: screenshotData.label,
                        payload: event,
                    });
                    return;
                }

                try {
                    const artifact = await uploadRunArtifact(runId, {
                        filename: toSafeScreenshotFilename(screenshotData.label, parsed.extension),
                        mimeType: parsed.mimeType,
                        contentBase64: parsed.contentBase64,
                    });
                    queueEvent({
                        kind: 'SCREENSHOT',
                        message: screenshotData.label,
                        artifactKey: artifact.artifactKey,
                        payload: {
                            ...event,
                            data: {
                                ...screenshotData,
                                src: `artifact:${artifact.artifactKey}`,
                            },
                        },
                    });
                } catch (error) {
                    logger.warn('Failed to upload screenshot artifact', error);
                    queueEvent({
                        kind: 'SCREENSHOT',
                        message: screenshotData.label,
                        payload: event,
                    });
                }
            })();

            pendingArtifactUploads.add(uploadTask);
            uploadTask.finally(() => {
                pendingArtifactUploads.delete(uploadTask);
            }).catch(() => {});
            return;
        }

        queueEvent({
            kind: event.type.toUpperCase(),
            message: event.type === 'log' && 'message' in event.data ? event.data.message : undefined,
            payload: event,
        });
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
                handleTestEvent(event);
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

        await Promise.allSettled(Array.from(pendingArtifactUploads));
        await flushEvents();

        const resultSummary = JSON.stringify(result);
        if (result.status === 'PASS') {
            await markRunComplete(runId, resultSummary);
            return;
        }

        await markRunFailed(runId, result.error ?? 'Run failed', resultSummary);
    } catch (error) {
        await Promise.allSettled(Array.from(pendingArtifactUploads));
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
    const releaseLock = await acquireRunnerLock();

    try {
        try {
            await bootstrapRunnerCredential();

            await registerRunner();
        } catch (error) {
            if (error instanceof RunnerHttpError && error.status === 401 && pairingToken) {
                authState = await exchangePairingCredential();
                await registerRunner();
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
    } finally {
        await releaseLock();
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
