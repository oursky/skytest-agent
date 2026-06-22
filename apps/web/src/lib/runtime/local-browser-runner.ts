import { runTest } from '@/lib/runtime/test-runner';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { config as appConfig } from '@/config/app';
import { InvalidAiApiKeyError } from '@/lib/core/errors';
import { loadRunConfig } from '@/lib/runtime/run-config-loader';
import { createRunEventSink, createRunStatusWatcher, touchRunActivity } from '@/lib/runtime/run-event-sink';
import { finalizeMemberRunError, finalizeMemberRunResult } from '@/lib/runtime/run-member-finalize';
import { executeLocalBrowserSession } from '@/lib/runtime/run-session-orchestrator';
import {
    failRunWithoutTestCase,
    updateRunStatusWithOwnership,
    type LocalBrowserRunOptions,
} from '@/lib/runtime/local-browser-runner-lifecycle';
import {
    TEST_STATUS,
    isRunInProgressStatus,
} from '@/types';
const logger = createLogger('runtime:local-browser-runner');
const activeAbortControllers = new Map<string, AbortController>();
const activeExecutions = new Map<string, Promise<void>>();
export function getActiveLocalBrowserRunCount(): number {
    return activeExecutions.size;
}
export function getMaxLocalBrowserRunCount(): number {
    return appConfig.runner.maxLocalBrowserRuns;
}
export function hasLocalBrowserRunCapacity(): boolean {
    return getActiveLocalBrowserRunCount() < getMaxLocalBrowserRunCount();
}
export function getActiveLocalBrowserRunIds(): string[] {
    return Array.from(activeAbortControllers.keys());
}

export async function abortInactiveLocalBrowserRuns(options?: LocalBrowserRunOptions): Promise<number> {
    const activeRunIds = getActiveLocalBrowserRunIds();
    if (activeRunIds.length === 0) {
        return 0;
    }

    const nowMs = Date.now();
    const runs = await prisma.testRun.findMany({
        where: {
            id: { in: activeRunIds },
        },
        select: {
            id: true,
            status: true,
            assignedRunnerId: true,
            leaseExpiresAt: true,
            runSession: { select: { status: true } },
        },
    });
    const runById = new Map(runs.map((run) => [run.id, run]));
    let abortedCount = 0;

    for (const runId of activeRunIds) {
        const run = runById.get(runId);
        const leaseValid = run?.leaseExpiresAt ? run.leaseExpiresAt.getTime() > nowMs : false;
        // A multi-member session stays active while its session is in progress even
        // after the claimed first member settles (later members run in the shared browser).
        const executionInProgress = !!run
            && (isRunInProgressStatus(run.status) || isRunInProgressStatus(run.runSession?.status));
        const stillActive = executionInProgress
            && (
                options?.runnerId
                    ? run.assignedRunnerId === options.runnerId
                    && leaseValid
                    : !run.assignedRunnerId
            );
        if (stillActive) {
            continue;
        }

        if (cancelLocalBrowserRun(runId)) {
            abortedCount += 1;
        }
    }

    return abortedCount;
}

async function executeLocalBrowserRun(
    runId: string,
    controller: AbortController,
    options?: LocalBrowserRunOptions
): Promise<void> {
    const details = await loadRunConfig(runId, options);
    if (!details) {
        await failRunWithoutTestCase(runId, 'Run is not executable', options).catch(() => {});
        return;
    }

    const sink = createRunEventSink(runId, options);
    const statusWatcher = createRunStatusWatcher(
        runId,
        controller.signal,
        () => { cancelLocalBrowserRun(runId); },
        options,
    );
    const usage = {
        actorUserId: details.usage.actorUserId,
        projectId: details.projectId,
        description: details.usage.description,
    };
    statusWatcher.start();

    try {
        const result = await runTest({
            runId,
            config: {
                url: details.config.url,
                prompt: details.config.prompt,
                steps: details.config.steps,
                browserConfig: details.config.browserConfig,
                teamId: details.config.teamId,
                openRouterApiKey: details.config.openRouterApiKey,
                aiProvider: details.config.aiProvider,
                midsceneModelOptions: details.config.midsceneModelOptions,
                testCaseId: details.testCaseId,
                projectId: details.projectId,
                files: details.config.files,
                resolvedVariables: details.config.resolvedVariables,
                resolvedFiles: details.config.resolvedFiles,
            },
            signal: controller.signal,
            onEvent(event) {
                sink.handleTestEvent(event);
            },
            async onPreparing() {
                await updateRunStatusWithOwnership(runId, TEST_STATUS.PREPARING, options);
                sink.queueEvent({ kind: 'STATUS', message: 'Preparing run execution' });
            },
            async onRunning() {
                await updateRunStatusWithOwnership(runId, TEST_STATUS.RUNNING, options);
                sink.queueEvent({ kind: 'STATUS', message: 'Running test steps' });
            },
            async onStepHeartbeat() {
                await touchRunActivity(runId, options);
            },
        });

        await sink.settleUploads();
        await sink.flush();
        await finalizeMemberRunResult(runId, details.testCaseId, usage, result, options);
    } catch (error) {
        await sink.settleUploads();
        await sink.flush();
        if (error instanceof InvalidAiApiKeyError) {
            logger.error('Invalid team AI key format detected while dispatching local browser run', {
                runId: details.runId,
                teamId: details.config.teamId,
                provider: details.config.aiProvider,
                modelFamily: details.config.midsceneModelOptions?.mainModelFamily ?? null,
                reason: error.reason,
            });
        }
        await finalizeMemberRunError(runId, details.testCaseId, usage, error, options);
    } finally {
        statusWatcher.stop();
    }
}

export function startLocalBrowserRun(runId: string, options?: LocalBrowserRunOptions): Promise<void> {
    const existingExecution = activeExecutions.get(runId);
    if (existingExecution) {
        return existingExecution;
    }

    const controller = new AbortController();
    activeAbortControllers.set(runId, controller);

    const execution = runClaimedBrowserWork(runId, controller, options)
        .catch((error) => {
            logger.error('Local browser run execution failed', error);
        })
        .finally(() => {
            activeAbortControllers.delete(runId);
            activeExecutions.delete(runId);
        });

    activeExecutions.set(runId, execution);
    return execution;
}

/**
 * The dispatcher claims the first member of a run session. A single-member session
 * runs the proven single-run path; a multi-member session (e.g. a login-flow prefix
 * followed by a test) runs all members in one shared browser via the orchestrator.
 */
async function runClaimedBrowserWork(
    runId: string,
    controller: AbortController,
    options?: LocalBrowserRunOptions,
): Promise<void> {
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: {
            runSessionId: true,
            runSession: { select: { _count: { select: { memberRuns: true } } } },
        },
    });
    const sessionId = run?.runSessionId ?? null;
    const memberCount = run?.runSession?._count.memberRuns ?? 1;
    if (sessionId && memberCount > 1) {
        await executeLocalBrowserSession(sessionId, controller, options);
        return;
    }
    await executeLocalBrowserRun(runId, controller, options);
}

export function cancelLocalBrowserRun(runId: string): boolean {
    const controller = activeAbortControllers.get(runId);
    if (!controller || controller.signal.aborted) {
        return false;
    }
    controller.abort();
    return true;
}
