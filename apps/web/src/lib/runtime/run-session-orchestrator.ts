import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { config as appConfig } from '@/config/app';
import { getErrorMessage } from '@/lib/core/errors';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { substituteAll } from '@/lib/test-config/substitution';
import { normalizeBrowserConfig } from '@/lib/test-config/browser-target';
import { buildMidsceneModelConfig } from '@/lib/runtime/midscene-env';
import { prepareExecutionFiles } from '@/lib/runtime/execution-files';
import { loadRunConfig, type LoadedRunConfig } from '@/lib/runtime/run-config-loader';
import { createRunEventSink, createRunStatusWatcher, touchRunActivity } from '@/lib/runtime/run-event-sink';
import { finalizeMemberRunResult } from '@/lib/runtime/run-member-finalize';
import {
    setupExecutionTargets,
    cleanupTargets,
    executeUnit,
    type ExecutionTargets,
    type ActionCounter,
} from '@/lib/runtime/test-runner';
import {
    failRunWithoutTestCase,
    updateRunStatusWithOwnership,
    createLeaseExpiry,
    type LocalBrowserRunOptions,
} from '@/lib/runtime/local-browser-runner-lifecycle';
import { recomputeRunSessionForMember } from '@/lib/runtime/run-session-service';
import {
    TEST_STATUS,
    isRunInProgressStatus,
    type BrowserConfig,
    type TargetConfig,
    type TestEvent,
    type TestStep,
} from '@/types';

const logger = createLogger('runtime:run-session-orchestrator');

interface SessionMember {
    id: string;
    sessionPosition: number | null;
    testCaseId: string;
}

function isAndroidConfig(cfg: BrowserConfig | TargetConfig): boolean {
    return 'type' in cfg && cfg.type === 'android';
}

interface PreparedUnit {
    url?: string;
    steps?: TestStep[];
    prompt?: string;
    resolvedVariables: Record<string, string>;
    resolvedConfigFiles: Record<string, string>;
    materializedExecutionFiles: Awaited<ReturnType<typeof prepareExecutionFiles>>;
}

/** Resolves a member's url/steps (config variable + file substitution) and materializes its files. */
async function prepareMemberUnit(details: LoadedRunConfig): Promise<PreparedUnit> {
    const materializedExecutionFiles = await prepareExecutionFiles(
        details.config.files,
        details.config.resolvedFiles,
        details.runId,
    );
    const vars = details.config.resolvedVariables || {};
    const fileRefs = materializedExecutionFiles.configFiles;
    const sub = (text: string) => substituteAll(text, vars, fileRefs);

    const browserConfig = details.config.browserConfig;
    const primaryBrowserUrl = browserConfig
        ? Object.values(browserConfig)
            .filter((cfg): cfg is BrowserConfig => !isAndroidConfig(cfg))
            .map((cfg) => cfg.url)
            .find((url) => !!url)
        : undefined;
    const rawUrl = primaryBrowserUrl ?? details.config.url;

    return {
        url: rawUrl ? sub(rawUrl) : rawUrl,
        steps: details.config.steps?.map((step) => ({ ...step, action: sub(step.action) })),
        prompt: details.config.prompt ? sub(details.config.prompt) : details.config.prompt,
        resolvedVariables: vars,
        resolvedConfigFiles: materializedExecutionFiles.configFiles,
        materializedExecutionFiles,
    };
}

/** Derives the shared browser target id + viewport from the anchor (test) member's config. */
function resolveAnchorBrowserTarget(details: LoadedRunConfig): { targetId: string; config: BrowserConfig } | null {
    const browserConfig = details.config.browserConfig;
    if (browserConfig) {
        const entry = Object.entries(browserConfig).find(([, cfg]) => !isAndroidConfig(cfg));
        if (entry) {
            return { targetId: entry[0], config: normalizeBrowserConfig(entry[1] as BrowserConfig) };
        }
    }
    if (details.config.url) {
        return { targetId: 'main', config: normalizeBrowserConfig({ url: details.config.url }) };
    }
    return null;
}

/** Transitions a queued member to PREPARING. Returns whether the member is runnable
 * (freshly claimed, or already in progress); false if it was settled externally. */
async function claimSessionMember(runId: string): Promise<boolean> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: { id: runId, status: TEST_STATUS.QUEUED, assignedRunnerId: null },
        data: { status: TEST_STATUS.PREPARING, startedAt: now, leaseExpiresAt: createLeaseExpiry(now) },
    });
    if (updated.count > 0) {
        publishRunUpdate(runId);
        await recomputeRunSessionForMember(runId);
        return true;
    }
    const run = await prisma.testRun.findUnique({ where: { id: runId }, select: { status: true } });
    return run ? isRunInProgressStatus(run.status) : false;
}

async function markMembersSkipped(runIds: string[]): Promise<void> {
    if (runIds.length === 0) {
        return;
    }
    const now = new Date();
    await prisma.testRun.updateMany({
        where: { id: { in: runIds }, status: { in: [TEST_STATUS.QUEUED, TEST_STATUS.PREPARING] } },
        data: { status: TEST_STATUS.SKIPPED, completedAt: now, assignedRunnerId: null, leaseExpiresAt: null },
    });
    for (const runId of runIds) {
        publishRunUpdate(runId);
    }
    await recomputeRunSessionForMember(runIds[0]);
}

/**
 * Runs an ordered, multi-member browser session inside one shared browser so the
 * authenticated state from a login-flow prefix carries into the test that follows.
 * The last member is the anchor test (defines viewport + target id); earlier members
 * are login-flow prefixes executed against the anchor's primary browser target.
 * Stops on the first non-pass member and marks the rest SKIPPED.
 */
export async function executeLocalBrowserSession(
    sessionId: string,
    controller: AbortController,
    options?: LocalBrowserRunOptions,
): Promise<void> {
    const members: SessionMember[] = await prisma.testRun.findMany({
        where: { runSessionId: sessionId },
        orderBy: { sessionPosition: 'asc' },
        select: { id: true, sessionPosition: true, testCaseId: true },
    });
    if (members.length === 0) {
        return;
    }

    const anchor = members[members.length - 1];
    const anchorDetails = await loadRunConfig(anchor.id, options, { allowNonRunning: true });
    if (!anchorDetails) {
        await Promise.all(members.map((member) => failRunWithoutTestCase(member.id, 'Run is not executable', options).catch(() => {})));
        return;
    }

    const anchorTarget = resolveAnchorBrowserTarget(anchorDetails);
    if (!anchorTarget) {
        await Promise.all(members.map((member) => failRunWithoutTestCase(member.id, 'Session requires a browser target', options).catch(() => {})));
        return;
    }

    const midsceneModelConfig = buildMidsceneModelConfig(
        anchorDetails.config.openRouterApiKey,
        anchorDetails.config.midsceneModelOptions,
    );
    const actionCounter: ActionCounter = { count: 0 };
    const openConfigs: Record<string, BrowserConfig> = {
        [anchorTarget.targetId]: { ...anchorTarget.config, url: '' },
    };

    // The Playwright agents are created once at open time with a fixed event
    // handler, but each member persists to its own run. Route agent events (AI
    // tips/screenshots) to whichever member is currently executing.
    let currentOnEvent: (event: TestEvent) => void = () => {};
    const routedOnEvent = (event: TestEvent) => currentOnEvent(event);

    let targets: ExecutionTargets;
    try {
        targets = await setupExecutionTargets(
            openConfigs,
            routedOnEvent,
            anchor.id,
            anchorDetails.projectId,
            midsceneModelConfig,
            controller.signal,
            actionCounter,
        );
    } catch (error) {
        const message = getErrorMessage(error);
        logger.error('Failed to open shared browser session', { sessionId, error: message });
        await Promise.all(members.map((member) => failRunWithoutTestCase(member.id, message, options).catch(() => {})));
        return;
    }

    try {
        for (let index = 0; index < members.length; index += 1) {
            const member = members[index];
            const isAnchor = index === members.length - 1;
            if (controller.signal.aborted) {
                await markMembersSkipped(members.slice(index).map((m) => m.id));
                break;
            }

            const runnable = await claimSessionMember(member.id);
            if (!runnable) {
                // Member was cancelled/settled externally; stop the session and skip the rest.
                await markMembersSkipped(members.slice(index + 1).map((m) => m.id));
                break;
            }
            const details = await loadRunConfig(member.id, options, { allowNonRunning: true });
            if (!details) {
                await failRunWithoutTestCase(member.id, 'Run is not executable', options).catch(() => {});
                await markMembersSkipped(members.slice(index + 1).map((m) => m.id));
                break;
            }

            const usage = {
                actorUserId: details.usage.actorUserId,
                projectId: details.projectId,
                description: details.usage.description,
            };
            const sink = createRunEventSink(member.id, options);
            const watcher = createRunStatusWatcher(member.id, controller.signal, () => controller.abort(), options);
            watcher.start();

            const memberController = new AbortController();
            const onSessionAbort = () => memberController.abort();
            if (controller.signal.aborted) {
                memberController.abort();
            } else {
                controller.signal.addEventListener('abort', onSessionAbort, { once: true });
            }
            let timedOut = false;
            const timeoutHandle = setTimeout(() => {
                timedOut = true;
                memberController.abort();
            }, appConfig.test.maxDuration * 1000);

            let result;
            try {
                await updateRunStatusWithOwnership(member.id, TEST_STATUS.RUNNING, options);
                sink.queueEvent({ kind: 'STATUS', message: 'Running test steps' });

                const prepared = await prepareMemberUnit(details);
                // Every member runs against the anchor's shared browser context so the
                // login prefix's cookies persist into the test. Prefix members are
                // retargeted onto the anchor's primary browser target.
                const execConfigs: Record<string, BrowserConfig> = {
                    [anchorTarget.targetId]: { ...anchorTarget.config, url: prepared.url ?? '' },
                };
                const execSteps = isAnchor
                    ? prepared.steps
                    : prepared.steps?.map((step) => ({ ...step, target: anchorTarget.targetId }));

                currentOnEvent = (event) => sink.handleTestEvent(event);
                try {
                    result = await executeUnit({
                        targets,
                        targetConfigs: execConfigs,
                        steps: execSteps,
                        prompt: isAnchor ? prepared.prompt : undefined,
                        onEvent: (event) => sink.handleTestEvent(event),
                        runId: member.id,
                        materializedExecutionFiles: prepared.materializedExecutionFiles,
                        signal: memberController.signal,
                        resolvedVariables: prepared.resolvedVariables,
                        resolvedConfigFiles: prepared.resolvedConfigFiles,
                        onStepHeartbeat: async () => { await touchRunActivity(member.id, options); },
                        actionCounter,
                    });
                } finally {
                    await prepared.materializedExecutionFiles.cleanup();
                }
            } finally {
                currentOnEvent = () => {};
                clearTimeout(timeoutHandle);
                controller.signal.removeEventListener('abort', onSessionAbort);
                watcher.stop();
            }

            if (timedOut && result.status === TEST_STATUS.CANCELLED) {
                result = {
                    status: TEST_STATUS.FAIL,
                    error: `Test exceeded maximum duration (${appConfig.test.maxDuration}s)`,
                    errorCode: 'TEST_TIMEOUT' as const,
                    errorCategory: 'TIMEOUT' as const,
                    actionCount: result.actionCount,
                };
            }

            await sink.settleUploads();
            await sink.flush();
            await finalizeMemberRunResult(member.id, member.testCaseId, usage, result, options);

            if (result.status !== TEST_STATUS.PASS) {
                await markMembersSkipped(members.slice(index + 1).map((m) => m.id));
                break;
            }
        }
    } finally {
        await cleanupTargets(targets);
    }
}
