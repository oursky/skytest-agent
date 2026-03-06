import {
    RUNNER_PROTOCOL_CURRENT_VERSION,
    claimJobResponseSchema,
    completeRunResponseSchema,
    completeRunRequestSchema,
    failRunRequestSchema,
    ingestEventsRequestSchema,
    jobDetailsRequestSchema,
    jobDetailsResponseSchema,
    registerRunnerRequestSchema,
    registerRunnerResponseSchema,
    type RunnerEventInput,
} from '@skytest/runner-protocol';
import { createLogger } from '@/lib/core/logger';
import { runTest } from '@/lib/runtime/test-runner';
import type { BrowserConfig, TargetConfig, TestCaseFile, TestStep } from '@/types';

const logger = createLogger('runner:browser');
const runnerVersion = process.env.RUNNER_VERSION ?? '0.1.0';
const controlPlaneBaseUrl = process.env.RUNNER_CONTROL_PLANE_URL ?? 'http://127.0.0.1:3000';
const runnerToken = process.env.RUNNER_TOKEN;
const runnerLabel = process.env.RUNNER_LABEL ?? 'Hosted Browser Runner';
const capabilities = ['BROWSER'] as const;

const RUNNER_HEADERS: HeadersInit = {
    'Content-Type': 'application/json',
};

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

interface RunnerTransportSettings {
    heartbeatIntervalSeconds: number;
}

function buildRunnerHeaders(): HeadersInit {
    if (!runnerToken) {
        throw new Error('RUNNER_TOKEN is required');
    }

    return {
        ...RUNNER_HEADERS,
        Authorization: `Bearer ${runnerToken}`,
    };
}

async function postRunnerApi<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(new URL(path, controlPlaneBaseUrl), {
        method: 'POST',
        headers: buildRunnerHeaders(),
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Runner API ${path} failed with ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
}

async function registerRunner(): Promise<RunnerTransportSettings> {
    const payload = registerRunnerRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
        label: runnerLabel,
        kind: 'HOSTED_BROWSER',
        capabilities,
    });
    const response = await postRunnerApi('/api/runners/v1/register', payload);
    const parsed = registerRunnerResponseSchema.parse(response);

    return {
        heartbeatIntervalSeconds: parsed.transport.heartbeatIntervalSeconds,
    };
}

async function sendHeartbeat() {
    await postRunnerApi('/api/runners/v1/heartbeat', {
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
    });
}

async function claimJob() {
    const response = await postRunnerApi('/api/runners/v1/jobs/claim', {
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion,
    });
    return claimJobResponseSchema.parse(response).job;
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

    await postRunnerApi(`/api/runners/v1/jobs/${runId}/events`, payload);
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
        const errorMessage = error instanceof Error ? error.message : String(error);
        await markRunFailed(runId, errorMessage);
    }
}

async function start() {
    if (!runnerToken) {
        throw new Error('RUNNER_TOKEN is required');
    }

    const transport = await registerRunner();
    setInterval(() => {
        void sendHeartbeat().catch((error) => {
            logger.error('Heartbeat failed', error);
        });
    }, transport.heartbeatIntervalSeconds * 1000);

    while (true) {
        try {
            const job = await claimJob();
            if (!job) {
                continue;
            }

            await executeClaimedRun(job.runId);
        } catch (error) {
            logger.error('Claim loop failed', error);
            await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
    }
}

void start().catch((error) => {
    logger.error('Browser runner crashed', error);
    process.exitCode = 1;
});
