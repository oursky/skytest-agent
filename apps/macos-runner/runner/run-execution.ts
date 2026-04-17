import type { RunnerEventInput } from '@skytest/runner-protocol';
import { runTest } from '../../web/src/lib/runtime/test-runner';
import { isScreenshotData } from '../../web/src/types/events';
import type { BrowserConfig, TargetConfig, TestCaseFile, TestEvent, TestStep } from '../../web/src/types';
import type { BuildMidsceneModelConfigOptions } from '../../web/src/lib/runtime/midscene-env';

interface ParsedImageDataUrl {
    mimeType: string;
    extension: string;
    contentBase64: string;
}

export interface JobDetailsConfig {
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    openRouterApiKey: string;
    aiProvider?: string;
    midsceneModelOptions?: BuildMidsceneModelConfigOptions;
    files: TestCaseFile[];
    resolvedVariables: Record<string, string>;
    resolvedFiles: Record<string, string>;
}

export interface JobDetailsPayload {
    runId: string;
    testCaseId: string;
    projectId: string;
    config: JobDetailsConfig;
}

interface UploadArtifactPayload {
    filename: string;
    mimeType: string;
    contentBase64: string;
}

interface UploadedArtifact {
    artifactKey: string;
}

interface RunnerExecutionApi {
    loadJobDetails(runId: string): Promise<JobDetailsPayload>;
    postRunEvents(runId: string, events: RunnerEventInput[]): Promise<void>;
    uploadRunArtifact(runId: string, payload: UploadArtifactPayload): Promise<UploadedArtifact>;
    markRunComplete(runId: string, result?: string): Promise<void>;
    markRunFailed(runId: string, error: string, result?: string): Promise<void>;
}

interface RunnerExecutionLogger {
    warn(message: string, meta?: unknown): void;
    error(message: string, meta?: unknown): void;
}

interface ExecuteClaimedRunOptions {
    runId: string;
    api: RunnerExecutionApi;
    logger: RunnerExecutionLogger;
    isRunOwnershipLostError(error: unknown): boolean;
    isRunOwnershipArtifactError(error: unknown): boolean;
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

export async function executeClaimedRun(options: ExecuteClaimedRunOptions): Promise<void> {
    const { runId, api, logger, isRunOwnershipLostError, isRunOwnershipArtifactError } = options;
    const details = await api.loadJobDetails(runId);
    const queuedEvents: RunnerEventInput[] = [];
    const pendingArtifactUploads = new Set<Promise<void>>();
    const runAbortController = new AbortController();
    let flushingEvents = false;
    let acceptsRunEvents = true;

    const flushEvents = async () => {
        if (!acceptsRunEvents) {
            queuedEvents.length = 0;
            return;
        }

        if (flushingEvents || queuedEvents.length === 0) {
            return;
        }

        flushingEvents = true;
        try {
            while (queuedEvents.length > 0) {
                const batch = queuedEvents.splice(0, 50);
                try {
                    await api.postRunEvents(runId, batch);
                } catch (error) {
                    if (isRunOwnershipLostError(error)) {
                        acceptsRunEvents = false;
                        if (!runAbortController.signal.aborted) {
                            runAbortController.abort();
                        }
                        queuedEvents.length = 0;
                        logger.warn('Dropping run events because run ownership is no longer valid', { runId });
                        return;
                    }
                    throw error;
                }
            }
        } finally {
            flushingEvents = false;
        }
    };

    const queueEvent = (event: RunnerEventInput) => {
        if (!acceptsRunEvents) {
            return;
        }
        queuedEvents.push(event);
        void flushEvents().catch((error) => {
            logger.error('Failed to flush run events', error);
        });
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
                    const artifact = await api.uploadRunArtifact(runId, {
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
                    if (isRunOwnershipArtifactError(error)) {
                        acceptsRunEvents = false;
                        if (!runAbortController.signal.aborted) {
                            runAbortController.abort();
                        }
                        logger.warn('Stopping artifact upload because run ownership is no longer valid', { runId });
                        return;
                    }
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

        const logMessage = event.type === 'log'
            && 'message' in event.data
            ? event.data.message
            : undefined;
        queueEvent({
            kind: event.type.toUpperCase(),
            message: logMessage,
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
                aiProvider: details.config.aiProvider,
                midsceneModelOptions: details.config.midsceneModelOptions,
                testCaseId: details.testCaseId,
                projectId: details.projectId,
                files: details.config.files,
                resolvedVariables: details.config.resolvedVariables,
                resolvedFiles: details.config.resolvedFiles,
            },
            onEvent(event) {
                handleTestEvent(event);
            },
            signal: runAbortController.signal,
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
            try {
                await api.markRunComplete(runId, resultSummary);
            } catch (error) {
                if (isRunOwnershipLostError(error)) {
                    logger.warn('Run ownership lost before completion update', { runId });
                    return;
                }
                throw error;
            }
            return;
        }

        try {
            await api.markRunFailed(runId, result.error ?? 'Run failed', resultSummary);
        } catch (error) {
            if (isRunOwnershipLostError(error)) {
                logger.warn('Run ownership lost before failure update', { runId });
                return;
            }
            throw error;
        }
    } catch (error) {
        await Promise.allSettled(Array.from(pendingArtifactUploads));
        try {
            await flushEvents();
        } catch (flushError) {
            logger.warn('Failed to flush queued events after run error', flushError);
        }
        const message = error instanceof Error ? error.message : String(error);
        try {
            await api.markRunFailed(runId, message);
        } catch (markError) {
            if (isRunOwnershipLostError(markError)) {
                logger.warn('Run ownership lost while reporting run error', { runId, error: message });
                return;
            }
            throw markError;
        }
    }
}
