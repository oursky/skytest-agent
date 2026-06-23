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
    createBrowserTargetContext,
    closeBrowserTargetContext,
    executeUnit,
    type ExecutionTargets,
    type ActionCounter,
    type BrowserStorageState,
} from '@/lib/runtime/test-runner';
import { shouldStopAfterFailure } from '@/lib/runtime/test-group-session-plan';
import {
    failRunWithoutTestCase,
    updateRunStatusWithOwnership,
    createLeaseExpiry,
    type LocalBrowserRunOptions,
} from '@/lib/runtime/local-browser-runner-lifecycle';
import { recomputeRunSessionForMember } from '@/lib/runtime/run-session-service';
import {
    RUN_SESSION_KIND,
    TEST_CASE_KIND,
    TEST_STATUS,
    TEST_GROUP_FAILURE_MODE,
    isRunInProgressStatus,
    type BrowserConfig,
    type TargetConfig,
    type TestEvent,
    type TestResult,
    type TestStep,
    type TestGroupFailureMode,
} from '@/types';

const logger = createLogger('runtime:run-session-orchestrator');

interface SessionMember {
    id: string;
    sessionPosition: number | null;
    testCaseId: string;
    kind: string;
    reusedSession: boolean;
}

function isAndroidConfig(cfg: BrowserConfig | TargetConfig): boolean {
    return 'type' in cfg && cfg.type === 'android';
}

/** Whether a loaded member wants a virtual WebAuthn authenticator on its primary browser. */
function loadedConfigWantsWebauthn(details: LoadedRunConfig): boolean {
    const browserConfig = details.config.browserConfig;
    const primaryBrowser = browserConfig
        ? Object.values(browserConfig).find((cfg): cfg is BrowserConfig => !isAndroidConfig(cfg))
        : undefined;
    return primaryBrowser ? (normalizeBrowserConfig(primaryBrowser).webauthnVirtualAuthenticator ?? false) : false;
}

interface PreparedUnit {
    url?: string;
    steps?: TestStep[];
    prompt?: string;
    viewport: { width: number; height: number };
    reuseGroupSession: boolean;
    loginFlowId: string | null;
    webauthnVirtualAuthenticator: boolean;
    resolvedVariables: Record<string, string>;
    resolvedConfigFiles: Record<string, string>;
    materializedExecutionFiles: Awaited<ReturnType<typeof prepareExecutionFiles>>;
}

/** Resolves a member's url/steps/viewport (variable + file substitution) and materializes its files. */
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
    const primaryBrowser = browserConfig
        ? Object.values(browserConfig).find((cfg): cfg is BrowserConfig => !isAndroidConfig(cfg))
        : undefined;
    const normalizedPrimary = primaryBrowser
        ? normalizeBrowserConfig(primaryBrowser)
        : normalizeBrowserConfig({ url: details.config.url ?? '' });
    const rawUrl = normalizedPrimary.url || details.config.url;

    return {
        url: rawUrl ? sub(rawUrl) : rawUrl,
        steps: details.config.steps?.map((step) => ({ ...step, action: sub(step.action) })),
        prompt: details.config.prompt ? sub(details.config.prompt) : details.config.prompt,
        viewport: { width: normalizedPrimary.width, height: normalizedPrimary.height },
        reuseGroupSession: normalizedPrimary.reuseGroupSession ?? false,
        loginFlowId: normalizedPrimary.loginFlowId ?? null,
        webauthnVirtualAuthenticator: normalizedPrimary.webauthnVirtualAuthenticator ?? false,
        resolvedVariables: vars,
        resolvedConfigFiles: materializedExecutionFiles.configFiles,
        materializedExecutionFiles,
    };
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

interface MemberRunContext {
    targets: ExecutionTargets;
    targetId: string;
    actionCounter: ActionCounter;
    controller: AbortController;
    setCurrentOnEvent: (handler: (event: TestEvent) => void) => void;
    options?: LocalBrowserRunOptions;
}

/**
 * Runs one member (navigate + steps) against the shared browser's target, with the
 * member's own event sink, liveness watcher, and maxDuration guard; finalizes the
 * member run. Steps are retargeted to the shared target id. Returns the result.
 */
async function runSessionMember(
    member: SessionMember,
    details: LoadedRunConfig,
    prepared: PreparedUnit,
    ctx: MemberRunContext,
): Promise<TestResult> {
    const usage = {
        actorUserId: details.usage.actorUserId,
        projectId: details.projectId,
        description: details.usage.description,
    };
    const sink = createRunEventSink(member.id, ctx.options);
    const watcher = createRunStatusWatcher(member.id, ctx.controller.signal, () => ctx.controller.abort(), ctx.options);
    watcher.start();

    const memberController = new AbortController();
    const onSessionAbort = () => memberController.abort();
    if (ctx.controller.signal.aborted) {
        memberController.abort();
    } else {
        ctx.controller.signal.addEventListener('abort', onSessionAbort, { once: true });
    }
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
        timedOut = true;
        memberController.abort();
    }, appConfig.test.maxDuration * 1000);

    let result: TestResult;
    try {
        await updateRunStatusWithOwnership(member.id, TEST_STATUS.RUNNING, ctx.options);
        sink.queueEvent({ kind: 'STATUS', message: 'Running test steps' });
        ctx.setCurrentOnEvent((event) => sink.handleTestEvent(event));

        const execConfigs: Record<string, BrowserConfig> = {
            [ctx.targetId]: { width: prepared.viewport.width, height: prepared.viewport.height, url: prepared.url ?? '' },
        };
        const execSteps = prepared.steps?.map((step) => ({ ...step, target: ctx.targetId }));

        result = await executeUnit({
            targets: ctx.targets,
            targetConfigs: execConfigs,
            steps: execSteps,
            prompt: prepared.prompt,
            onEvent: (event) => sink.handleTestEvent(event),
            runId: member.id,
            materializedExecutionFiles: prepared.materializedExecutionFiles,
            signal: memberController.signal,
            resolvedVariables: prepared.resolvedVariables,
            resolvedConfigFiles: prepared.resolvedConfigFiles,
            onStepHeartbeat: async () => { await touchRunActivity(member.id, ctx.options); },
            actionCounter: ctx.actionCounter,
        });
    } finally {
        ctx.setCurrentOnEvent(() => {});
        clearTimeout(timeoutHandle);
        ctx.controller.signal.removeEventListener('abort', onSessionAbort);
        watcher.stop();
    }

    if (timedOut && result.status === TEST_STATUS.CANCELLED) {
        result = {
            status: TEST_STATUS.FAIL,
            error: `Test exceeded maximum duration (${appConfig.test.maxDuration}s)`,
            errorCode: 'TEST_TIMEOUT',
            errorCategory: 'TIMEOUT',
            actionCount: result.actionCount,
        };
    }

    await sink.settleUploads();
    await sink.flush();
    await finalizeMemberRunResult(member.id, member.testCaseId, usage, result, ctx.options);
    return result;
}

async function loadOrderedMembers(sessionId: string): Promise<SessionMember[]> {
    return prisma.testRun.findMany({
        where: { runSessionId: sessionId },
        orderBy: { sessionPosition: 'asc' },
        select: { id: true, sessionPosition: true, testCaseId: true, kind: true, reusedSession: true },
    });
}

/**
 * Executes a run session inside one shared browser. SINGLE sessions are a login-flow
 * prefix followed by the test (members continue in the same authenticated context).
 * GROUP sessions run an ordered list of cases sequentially, resetting the browser
 * context between cases unless a case opts into reusing the group's live session (#5).
 * Both stop on the first non-pass member and mark the remaining members SKIPPED (#6).
 */
export async function executeLocalBrowserSession(
    sessionId: string,
    controller: AbortController,
    options?: LocalBrowserRunOptions,
): Promise<void> {
    const session = await prisma.runSession.findUnique({ where: { id: sessionId }, select: { kind: true } });
    const members = await loadOrderedMembers(sessionId);
    if (members.length === 0) {
        return;
    }

    const isGroup = session?.kind === RUN_SESSION_KIND.GROUP;
    // SINGLE (login prefix): the test is the anchor and defines the viewport, the
    // prefix runs in its context. GROUP: the first member opens the context, later
    // members reset to their own viewport unless they reuse the live session.
    const openMember = isGroup ? members[0] : members[members.length - 1];
    const openDetails = await loadRunConfig(openMember.id, options, { allowNonRunning: true });
    if (!openDetails) {
        await Promise.all(members.map((member) => failRunWithoutTestCase(member.id, 'Run is not executable', options).catch(() => {})));
        return;
    }

    const openPrepared = await prepareMemberUnit(openDetails);
    await openPrepared.materializedExecutionFiles.cleanup();

    // The shared context is created once from the anchor, but a prefix member (e.g. a
    // passkey-based login flow) may need the virtual authenticator even when the anchor
    // does not — so enable it if any member in the session requires it.
    const otherMemberConfigs = await Promise.all(
        members
            .filter((member) => member.id !== openMember.id)
            .map((member) => loadRunConfig(member.id, options, { allowNonRunning: true })),
    );
    const sessionWantsWebauthn = openPrepared.webauthnVirtualAuthenticator
        || otherMemberConfigs.some((details) => (details ? loadedConfigWantsWebauthn(details) : false));

    const targetId = 'session_main';
    const midsceneModelConfig = buildMidsceneModelConfig(
        openDetails.config.openRouterApiKey,
        openDetails.config.midsceneModelOptions,
    );
    const actionCounter: ActionCounter = { count: 0 };

    let currentOnEvent: (event: TestEvent) => void = () => {};
    const routedOnEvent = (event: TestEvent) => currentOnEvent(event);
    const setCurrentOnEvent = (handler: (event: TestEvent) => void) => { currentOnEvent = handler; };

    let targets: ExecutionTargets;
    try {
        targets = await setupExecutionTargets(
            { [targetId]: { width: openPrepared.viewport.width, height: openPrepared.viewport.height, url: '', webauthnVirtualAuthenticator: sessionWantsWebauthn } },
            routedOnEvent,
            openMember.id,
            openDetails.projectId,
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

    const ctx: MemberRunContext = { targets, targetId, actionCounter, controller, setCurrentOnEvent, options };

    try {
        for (let index = 0; index < members.length; index += 1) {
            const member = members[index];
            if (controller.signal.aborted) {
                await markMembersSkipped(members.slice(index).map((m) => m.id));
                break;
            }

            const runnable = await claimSessionMember(member.id);
            if (!runnable) {
                await markMembersSkipped(members.slice(index + 1).map((m) => m.id));
                break;
            }
            const details = await loadRunConfig(member.id, options, { allowNonRunning: true });
            if (!details) {
                await failRunWithoutTestCase(member.id, 'Run is not executable', options).catch(() => {});
                await markMembersSkipped(members.slice(index + 1).map((m) => m.id));
                break;
            }

            const prepared = await prepareMemberUnit(details);
            try {
                if (index > 0) {
                    // GROUP cases reset to a fresh context unless they reuse the live
                    // session; SINGLE prefix members always continue in the same context.
                    const reuse = isGroup ? prepared.reuseGroupSession : true;
                    if (!reuse) {
                        await prisma.testRun.update({ where: { id: member.id }, data: { reusedSession: false } }).catch(() => {});
                        await closeBrowserTargetContext(targets, targetId);
                        const created = await createBrowserTargetContext({
                            browser: targets.browser!,
                            targetId,
                            browserConfig: { width: prepared.viewport.width, height: prepared.viewport.height, url: '', webauthnVirtualAuthenticator: prepared.webauthnVirtualAuthenticator },
                            onEvent: routedOnEvent,
                            midsceneModelConfig,
                            signal: controller.signal,
                            actionCounter,
                            navigate: false,
                        });
                        targets.contexts.set(targetId, created.context);
                        targets.pages.set(targetId, created.page);
                        targets.agents.set(targetId, created.agent);
                        targets.browserNetworkGuards.set(targetId, created.networkGuard);
                    } else {
                        await prisma.testRun.update({ where: { id: member.id }, data: { reusedSession: true } }).catch(() => {});
                    }
                }

                const result = await runSessionMember(member, details, prepared, ctx);
                if (result.status !== TEST_STATUS.PASS) {
                    await markMembersSkipped(members.slice(index + 1).map((m) => m.id));
                    break;
                }
            } finally {
                await prepared.materializedExecutionFiles.cleanup();
            }
        }
    } finally {
        await cleanupTargets(targets);
    }
}

async function loadGroupFailureMode(testGroupId: string | null): Promise<TestGroupFailureMode> {
    if (!testGroupId) {
        return TEST_GROUP_FAILURE_MODE.STOP;
    }
    const group = await prisma.testGroup.findUnique({ where: { id: testGroupId }, select: { onFailure: true } });
    return group?.onFailure === TEST_GROUP_FAILURE_MODE.CONTINUE
        ? TEST_GROUP_FAILURE_MODE.CONTINUE
        : TEST_GROUP_FAILURE_MODE.STOP;
}

/**
 * Executes a GROUP run session with multiple login sessions (Option A: baseline restore).
 * Each login-flow member runs once and its post-login storageState is captured, keyed by
 * login flow. Every member then runs in a fresh context: a test case whose primary target
 * reuses a session is seeded with that session's captured baseline, so a logout in one case
 * cannot affect later cases. Failure handling follows the group's onFailure mode (STOP skips
 * the remaining cases; CONTINUE runs them — cases depending on a failed login session simply
 * start unauthenticated).
 */
export async function executeGroupSession(
    sessionId: string,
    controller: AbortController,
    options?: LocalBrowserRunOptions,
): Promise<void> {
    const session = await prisma.runSession.findUnique({ where: { id: sessionId }, select: { testGroupId: true } });
    const mode = await loadGroupFailureMode(session?.testGroupId ?? null);
    const members = await loadOrderedMembers(sessionId);
    if (members.length === 0) {
        return;
    }

    const openMember = members[0];
    const openDetails = await loadRunConfig(openMember.id, options, { allowNonRunning: true });
    if (!openDetails) {
        await Promise.all(members.map((member) => failRunWithoutTestCase(member.id, 'Run is not executable', options).catch(() => {})));
        return;
    }
    const openPrepared = await prepareMemberUnit(openDetails);
    await openPrepared.materializedExecutionFiles.cleanup();

    const otherMemberConfigs = await Promise.all(
        members
            .filter((member) => member.id !== openMember.id)
            .map((member) => loadRunConfig(member.id, options, { allowNonRunning: true })),
    );
    const sessionWantsWebauthn = openPrepared.webauthnVirtualAuthenticator
        || otherMemberConfigs.some((details) => (details ? loadedConfigWantsWebauthn(details) : false));

    const targetId = 'session_main';
    const midsceneModelConfig = buildMidsceneModelConfig(
        openDetails.config.openRouterApiKey,
        openDetails.config.midsceneModelOptions,
    );
    const actionCounter: ActionCounter = { count: 0 };

    let currentOnEvent: (event: TestEvent) => void = () => {};
    const routedOnEvent = (event: TestEvent) => currentOnEvent(event);
    const setCurrentOnEvent = (handler: (event: TestEvent) => void) => { currentOnEvent = handler; };

    let targets: ExecutionTargets;
    try {
        targets = await setupExecutionTargets(
            { [targetId]: { width: openPrepared.viewport.width, height: openPrepared.viewport.height, url: '', webauthnVirtualAuthenticator: sessionWantsWebauthn } },
            routedOnEvent,
            openMember.id,
            openDetails.projectId,
            midsceneModelConfig,
            controller.signal,
            actionCounter,
        );
    } catch (error) {
        const message = getErrorMessage(error);
        logger.error('Failed to open group browser session', { sessionId, error: message });
        await Promise.all(members.map((member) => failRunWithoutTestCase(member.id, message, options).catch(() => {})));
        return;
    }

    const ctx: MemberRunContext = { targets, targetId, actionCounter, controller, setCurrentOnEvent, options };
    const baselines = new Map<string, BrowserStorageState>();

    try {
        for (let index = 0; index < members.length; index += 1) {
            const member = members[index];
            if (controller.signal.aborted) {
                await markMembersSkipped(members.slice(index).map((m) => m.id));
                break;
            }

            const runnable = await claimSessionMember(member.id);
            if (!runnable) {
                await markMembersSkipped(members.slice(index + 1).map((m) => m.id));
                break;
            }
            const details = await loadRunConfig(member.id, options, { allowNonRunning: true });
            if (!details) {
                await failRunWithoutTestCase(member.id, 'Run is not executable', options).catch(() => {});
                if (shouldStopAfterFailure(mode)) {
                    await markMembersSkipped(members.slice(index + 1).map((m) => m.id));
                    break;
                }
                continue;
            }

            const prepared = await prepareMemberUnit(details);
            const isLogin = member.kind === TEST_CASE_KIND.LOGIN_FLOW;
            const seed = !isLogin && prepared.reuseGroupSession && prepared.loginFlowId
                ? baselines.get(prepared.loginFlowId)
                : undefined;
            try {
                if (index > 0) {
                    await closeBrowserTargetContext(targets, targetId);
                    const created = await createBrowserTargetContext({
                        browser: targets.browser!,
                        targetId,
                        browserConfig: { width: prepared.viewport.width, height: prepared.viewport.height, url: '', webauthnVirtualAuthenticator: prepared.webauthnVirtualAuthenticator },
                        onEvent: routedOnEvent,
                        midsceneModelConfig,
                        signal: controller.signal,
                        actionCounter,
                        navigate: false,
                        storageState: seed,
                    });
                    targets.contexts.set(targetId, created.context);
                    targets.pages.set(targetId, created.page);
                    targets.agents.set(targetId, created.agent);
                    targets.browserNetworkGuards.set(targetId, created.networkGuard);
                }
                await prisma.testRun.update({ where: { id: member.id }, data: { reusedSession: !!seed } }).catch(() => {});

                const result = await runSessionMember(member, details, prepared, ctx);

                if (isLogin && result.status === TEST_STATUS.PASS) {
                    const context = targets.contexts.get(targetId);
                    if (context) {
                        try {
                            baselines.set(member.testCaseId, await context.storageState());
                        } catch {
                            // A baseline-capture failure just means dependent cases run unauthenticated.
                        }
                    }
                }

                if (result.status !== TEST_STATUS.PASS && shouldStopAfterFailure(mode)) {
                    await markMembersSkipped(members.slice(index + 1).map((m) => m.id));
                    break;
                }
            } finally {
                await prepared.materializedExecutionFiles.cleanup();
            }
        }
    } finally {
        await cleanupTargets(targets);
    }
}
