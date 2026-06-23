import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { config as appConfig } from '@/config/app';
import { getErrorMessage } from '@/lib/core/errors';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { emitRunTerminal } from '@/lib/runners/domain-events';
import { substituteAll } from '@/lib/test-config/substitution';
import { normalizeBrowserConfig } from '@/lib/test-config/browser-target';
import { buildMidsceneModelConfig } from '@/lib/runtime/midscene-env';
import { prepareExecutionFiles } from '@/lib/runtime/execution-files';
import { loadRunConfig, type LoadedRunConfig } from '@/lib/runtime/run-config-loader';
import { createRunEventSink, createRunStatusWatcher, touchRunActivity } from '@/lib/runtime/run-event-sink';
import { finalizeMemberRunError, finalizeMemberRunResult } from '@/lib/runtime/run-member-finalize';
import {
    runTest,
    setupExecutionTargets,
    cleanupTargets,
    createBrowserTargetContext,
    closeBrowserTargetContext,
    executeUnit,
    type ExecutionTargets,
    type ActionCounter,
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
    type RunTerminalStatus,
    type BrowserStorageState,
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

/**
 * When a login-flow prefix does not pass in a SINGLE session, propagate its outcome to
 * the test member (which never ran): FAIL if the login flow failed, CANCELLED if the user
 * cancelled it — with a clear reason naming the login flow and a link to its run.
 */
async function propagatePrefixOutcomeToTest(
    testMember: SessionMember,
    loginMember: SessionMember,
    prefixStatus: string,
    projectId: string,
): Promise<void> {
    const loginFlow = await prisma.testCase.findUnique({
        where: { id: loginMember.testCaseId },
        select: { displayId: true, name: true },
    });
    const flowLabel = `${loginFlow?.displayId ? `${loginFlow.displayId} ` : ''}${loginFlow?.name ?? 'login flow'}`.trim();
    const flowLink = `/test-cases/${loginMember.testCaseId}/history/${loginMember.id}`;
    const cancelled = prefixStatus === TEST_STATUS.CANCELLED;
    const status = cancelled ? TEST_STATUS.CANCELLED : TEST_STATUS.FAIL;
    const error = cancelled
        ? `Cancelled by user in login flow "${flowLabel}" before the test ran. View the cancelled login flow run: ${flowLink}`
        : `Failed in login flow "${flowLabel}" before the test ran. View the failed login flow run: ${flowLink}`;
    const result = JSON.stringify({
        status,
        error,
        errorCode: cancelled ? 'LOGIN_FLOW_CANCELLED' : 'LOGIN_FLOW_FAILED',
        errorCategory: 'LOGIN_FLOW',
    });

    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: { id: testMember.id, status: { in: [TEST_STATUS.QUEUED, TEST_STATUS.PREPARING] } },
        data: { status, error, result, completedAt: now, assignedRunnerId: null, leaseExpiresAt: null },
    });
    if (updated.count > 0) {
        await prisma.testCase.update({ where: { id: testMember.testCaseId }, data: { status } }).catch(() => {});
        publishRunUpdate(testMember.id);
        emitRunTerminal({ runId: testMember.id, status: status as RunTerminalStatus, testCaseId: testMember.testCaseId, projectId });
        await recomputeRunSessionForMember(testMember.id);
    }
}

async function loadOrderedMembers(sessionId: string): Promise<SessionMember[]> {
    return prisma.testRun.findMany({
        where: { runSessionId: sessionId },
        orderBy: { sessionPosition: 'asc' },
        select: { id: true, sessionPosition: true, testCaseId: true, kind: true, reusedSession: true },
    });
}

/**
 * Runs one login-flow prefix in its own browser context and, on pass, captures its
 * post-login storageState so the test can restore it per target. Finalizes the login
 * member (events/status) like any other run.
 */
async function runLoginPrefix(
    login: SessionMember,
    controller: AbortController,
    options?: LocalBrowserRunOptions,
): Promise<{ status: string; storageState?: BrowserStorageState; projectId: string }> {
    const runnable = await claimSessionMember(login.id);
    if (!runnable) {
        // Settled externally before we could run it (e.g. the session was cancelled).
        return { status: TEST_STATUS.CANCELLED, projectId: '' };
    }
    const details = await loadRunConfig(login.id, options, { allowNonRunning: true });
    if (!details) {
        await failRunWithoutTestCase(login.id, 'Run is not executable', options).catch(() => {});
        return { status: TEST_STATUS.FAIL, projectId: '' };
    }
    const prepared = await prepareMemberUnit(details);
    const targetId = 'session_main';
    const midsceneModelConfig = buildMidsceneModelConfig(details.config.openRouterApiKey, details.config.midsceneModelOptions);
    const actionCounter: ActionCounter = { count: 0 };
    let currentOnEvent: (event: TestEvent) => void = () => {};
    const routedOnEvent = (event: TestEvent) => currentOnEvent(event);
    const setCurrentOnEvent = (handler: (event: TestEvent) => void) => { currentOnEvent = handler; };

    let targets: ExecutionTargets;
    try {
        targets = await setupExecutionTargets(
            { [targetId]: { width: prepared.viewport.width, height: prepared.viewport.height, url: '', webauthnVirtualAuthenticator: prepared.webauthnVirtualAuthenticator } },
            routedOnEvent,
            login.id,
            details.projectId,
            midsceneModelConfig,
            controller.signal,
            actionCounter,
        );
    } catch (error) {
        await failRunWithoutTestCase(login.id, getErrorMessage(error), options).catch(() => {});
        await prepared.materializedExecutionFiles.cleanup();
        return { status: TEST_STATUS.FAIL, projectId: details.projectId };
    }

    const ctx: MemberRunContext = { targets, targetId, actionCounter, controller, setCurrentOnEvent, options };
    try {
        const result = await runSessionMember(login, details, prepared, ctx);
        let storageState: BrowserStorageState | undefined;
        if (result.status === TEST_STATUS.PASS) {
            const context = targets.contexts.get(targetId);
            if (context) {
                try {
                    storageState = await context.storageState();
                } catch {
                    // No baseline captured — the dependent target will run unauthenticated.
                }
            }
        }
        return { status: result.status, storageState, projectId: details.projectId };
    } finally {
        await prepared.materializedExecutionFiles.cleanup();
        await cleanupTargets(targets);
    }
}

/**
 * Runs the test member through the full multi-target engine, seeding each browser target
 * that reuses a login flow with that flow's captured storageState. Steps route to their
 * own targets, so a multi-target test (e.g. Shopper A + Shopper B) runs as independently
 * authenticated sessions rather than collapsing into one shared browser.
 */
async function runTestMemberWithBaselines(
    testMember: SessionMember,
    baselines: Map<string, BrowserStorageState>,
    controller: AbortController,
    options?: LocalBrowserRunOptions,
): Promise<void> {
    const runnable = await claimSessionMember(testMember.id);
    if (!runnable) {
        return;
    }
    const details = await loadRunConfig(testMember.id, options, { allowNonRunning: true });
    if (!details) {
        await failRunWithoutTestCase(testMember.id, 'Run is not executable', options).catch(() => {});
        return;
    }

    // Seed every browser target whose attached login flow produced a baseline. A login
    // flow attached to a target means "authenticate this target with this flow", so it
    // always applies here — reuseGroupSession only gates reuse of a Test Group's session,
    // not standalone login-flow prefixes.
    const targetStorageStates: Record<string, BrowserStorageState> = {};
    const browserConfig = details.config.browserConfig ?? {};
    for (const [targetKey, cfg] of Object.entries(browserConfig)) {
        if (!cfg || isAndroidConfig(cfg)) {
            continue;
        }
        const browser = cfg as BrowserConfig;
        const baseline = browser.loginFlowId ? baselines.get(browser.loginFlowId) : undefined;
        if (baseline) {
            targetStorageStates[targetKey] = baseline;
        }
    }

    const sink = createRunEventSink(testMember.id, options);
    const statusWatcher = createRunStatusWatcher(testMember.id, controller.signal, () => controller.abort(), options);
    const usage = {
        actorUserId: details.usage.actorUserId,
        projectId: details.projectId,
        description: details.usage.description,
    };
    statusWatcher.start();
    try {
        const result = await runTest({
            runId: testMember.id,
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
            targetStorageStates,
            signal: controller.signal,
            onEvent: (event) => sink.handleTestEvent(event),
            async onPreparing() {
                await updateRunStatusWithOwnership(testMember.id, TEST_STATUS.PREPARING, options);
                sink.queueEvent({ kind: 'STATUS', message: 'Preparing run execution' });
            },
            async onRunning() {
                await updateRunStatusWithOwnership(testMember.id, TEST_STATUS.RUNNING, options);
                sink.queueEvent({ kind: 'STATUS', message: 'Running test steps' });
            },
            async onStepHeartbeat() {
                await touchRunActivity(testMember.id, options);
            },
        });
        await sink.settleUploads();
        await sink.flush();
        await finalizeMemberRunResult(testMember.id, details.testCaseId, usage, result, options);
    } catch (error) {
        await sink.settleUploads();
        await sink.flush();
        await finalizeMemberRunError(testMember.id, details.testCaseId, usage, error, options);
    } finally {
        statusWatcher.stop();
    }
}

/**
 * Executes a SINGLE run session: one or more login-flow prefixes followed by the test.
 * Each login flow runs in its own context and its post-login storageState is captured;
 * the test then runs through the multi-target engine with each target seeded from its
 * login flow's baseline, so per-target login flows yield independent authenticated
 * sessions. A login flow that fails/cancels propagates its outcome to the test with a
 * reason + link (and the test does not run).
 */
/** Runs tasks over items with at most `limit` in flight; results stay in item order. */
async function runWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(limit, items.length));
    const workers = Array.from({ length: workerCount }, async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) {
                break;
            }
            results[index] = await task(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}

/** Parallelism for a session's independent login flows: the project's max-concurrent setting. */
async function loadSessionLoginConcurrency(sessionId: string): Promise<number> {
    const session = await prisma.runSession.findUnique({
        where: { id: sessionId },
        select: { project: { select: { maxConcurrentRuns: true } } },
    });
    return Math.max(1, session?.project?.maxConcurrentRuns ?? 1);
}

export async function executeLocalBrowserSession(
    sessionId: string,
    controller: AbortController,
    options?: LocalBrowserRunOptions,
): Promise<void> {
    const members = await loadOrderedMembers(sessionId);
    if (members.length === 0) {
        return;
    }
    const testMember = members[members.length - 1];
    const loginMembers = members.slice(0, members.length - 1);

    const baselines = new Map<string, BrowserStorageState>();

    if (loginMembers.length > 0) {
        if (controller.signal.aborted) {
            await markMembersSkipped(members.map((m) => m.id));
            return;
        }
        // Login flows are independent (each opens its own browser and captures its own
        // baseline), so run them in parallel up to the project's max-concurrent setting
        // instead of serially.
        const concurrency = await loadSessionLoginConcurrency(sessionId);
        const outcomes = await runWithConcurrency(loginMembers, concurrency, (login) => runLoginPrefix(login, controller, options));

        const failureIndex = outcomes.findIndex((outcome) => outcome.status !== TEST_STATUS.PASS || !outcome.storageState);
        if (failureIndex >= 0) {
            const outcome = outcomes[failureIndex];
            await propagatePrefixOutcomeToTest(testMember, loginMembers[failureIndex], outcome.status, outcome.projectId);
            return;
        }
        outcomes.forEach((outcome, index) => {
            baselines.set(loginMembers[index].testCaseId, outcome.storageState!);
        });
    }

    if (controller.signal.aborted) {
        await markMembersSkipped([testMember.id]);
        return;
    }
    await runTestMemberWithBaselines(testMember, baselines, controller, options);
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
