import { prisma } from '@/lib/core/prisma';
import { config as appConfig } from '@/config/app';
import { createLogger } from '@/lib/core/logger';
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
    executeUnit,
    type ExecutionTargets,
    type ActionCounter,
} from '@/lib/runtime/test-runner';
import { shouldStopAfterFailure } from '@/lib/runtime/test-group-session-plan';
import { createMemberAbortController } from '@/lib/runtime/member-abort-controller';
import { CANCELLATION_REASON } from '@/lib/runtime/cancellation-reasons';
import {
    failRunWithoutTestCase,
    updateRunStatusWithOwnership,
    createLeaseExpiry,
    withLoginFlowBrowserSlot,
    withSessionMemberBrowserSlot,
    type LocalBrowserRunOptions,
} from '@/lib/runtime/local-browser-runner-lifecycle';
import { failActiveSessionMembers, recomputeRunSessionForMember } from '@/lib/runtime/run-session-service';
import {
    TEST_CASE_KIND,
    TEST_STATUS,
    TEST_GROUP_FAILURE_MODE,
    TEST_GROUP_EXECUTION_MODE,
    isRunInProgressStatus,
    type BrowserConfig,
    type TargetConfig,
    type TestEvent,
    type TestResult,
    type TestStep,
    type TestGroupFailureMode,
    type TestGroupExecutionMode,
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

const CANCEL_REASON = CANCELLATION_REASON;

/**
 * Cancels session members that never get to run (an earlier member failed, a login
 * flow failed, or the run was stopped), recording a reason so the run viewer can
 * explain why. Replaces the old SKIPPED status — everything that doesn't run settles
 * CANCELLED. Each affected test case's status is set to CANCELLED too.
 */
async function cancelRemainingMembers(members: SessionMember[], reason: string): Promise<void> {
    if (members.length === 0) {
        return;
    }
    const now = new Date();
    const result = JSON.stringify({ status: TEST_STATUS.CANCELLED, error: reason, errorCode: 'SESSION_CANCELLED', errorCategory: 'CANCELLED' });
    const cancelledIds: string[] = [];
    for (const member of members) {
        const updated = await prisma.testRun.updateMany({
            where: { id: member.id, status: { in: [TEST_STATUS.QUEUED, TEST_STATUS.PREPARING] } },
            data: { status: TEST_STATUS.CANCELLED, error: reason, result, completedAt: now, assignedRunnerId: null, leaseExpiresAt: null },
        });
        if (updated.count > 0) {
            await prisma.testCase.update({ where: { id: member.testCaseId }, data: { status: TEST_STATUS.CANCELLED } }).catch(() => {});
            publishRunUpdate(member.id);
            cancelledIds.push(member.id);
        }
    }
    if (cancelledIds.length > 0) {
        logger.info('Cancelled remaining session members', { runIds: cancelledIds, reason });
        await recomputeRunSessionForMember(cancelledIds[0]);
    }
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
    const { controller: memberController, dispose: disposeMemberAbort } = createMemberAbortController(ctx.controller.signal);
    const watcher = createRunStatusWatcher(member.id, memberController.signal, () => memberController.abort(), ctx.options);
    watcher.start();

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
        disposeMemberAbort();
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
        ? `This test did not run because its login flow "${flowLabel}" was stopped. View the stopped login flow run: ${flowLink}`
        : `This test did not run because its login flow "${flowLabel}" failed. View the failed login flow run: ${flowLink}`;
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
    let prepared: PreparedUnit | null = null;
    let projectId = '';
    try {
        const details = await loadRunConfig(login.id, options, { allowNonRunning: true });
        if (!details) {
            await failRunWithoutTestCase(login.id, 'Run is not executable', options).catch(() => {});
            return { status: TEST_STATUS.FAIL, projectId: '' };
        }
        projectId = details.projectId;
        prepared = await prepareMemberUnit(details);
        const targetId = 'session_main';
        const midsceneModelConfig = buildMidsceneModelConfig(details.config.openRouterApiKey, details.config.midsceneModelOptions);
        const actionCounter: ActionCounter = { count: 0 };
        let currentOnEvent: (event: TestEvent) => void = () => {};
        const routedOnEvent = (event: TestEvent) => currentOnEvent(event);
        const setCurrentOnEvent = (handler: (event: TestEvent) => void) => { currentOnEvent = handler; };

        const targets = await setupExecutionTargets(
            { [targetId]: { width: prepared.viewport.width, height: prepared.viewport.height, url: '', webauthnVirtualAuthenticator: prepared.webauthnVirtualAuthenticator } },
            routedOnEvent,
            login.id,
            details.projectId,
            midsceneModelConfig,
            controller.signal,
            actionCounter,
        );

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
            await cleanupTargets(targets);
        }
    } catch (error) {
        // Any throw on the prefix path (config load, file materialization, browser
        // setup, member execution) must settle this member instead of rejecting the
        // session's Promise.all and stranding its siblings + the test member.
        await failRunWithoutTestCase(login.id, getErrorMessage(error), options).catch(() => {});
        return { status: TEST_STATUS.FAIL, projectId };
    } finally {
        if (prepared) {
            await prepared.materializedExecutionFiles.cleanup().catch(() => {});
        }
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
    requireReuseFlag = false,
): Promise<TestResult> {
    const runnable = await claimSessionMember(testMember.id);
    if (!runnable) {
        return { status: TEST_STATUS.CANCELLED };
    }
    const details = await loadRunConfig(testMember.id, options, { allowNonRunning: true });
    if (!details) {
        await failRunWithoutTestCase(testMember.id, 'Run is not executable', options).catch(() => {});
        return { status: TEST_STATUS.FAIL, error: 'Run is not executable' };
    }

    // Seed each browser target from its login flow's captured baseline. On a standalone
    // run a login flow attached to a target always authenticates it; inside a Test Group a
    // target only reuses the group's session when reuseGroupSession is opted in
    // (requireReuseFlag).
    const targetStorageStates: Record<string, BrowserStorageState> = {};
    const browserConfig = details.config.browserConfig ?? {};
    for (const [targetKey, cfg] of Object.entries(browserConfig)) {
        if (!cfg || isAndroidConfig(cfg)) {
            continue;
        }
        const browser = cfg as BrowserConfig;
        if (requireReuseFlag && !browser.reuseGroupSession) {
            continue;
        }
        const baseline = browser.loginFlowId ? baselines.get(browser.loginFlowId) : undefined;
        if (baseline) {
            targetStorageStates[targetKey] = baseline;
        }
    }

    const { controller: memberController, dispose: disposeMemberAbort } = createMemberAbortController(controller.signal);
    const sink = createRunEventSink(testMember.id, options);
    const statusWatcher = createRunStatusWatcher(testMember.id, memberController.signal, () => memberController.abort(), options);
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
            signal: memberController.signal,
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
        return result;
    } catch (error) {
        await sink.settleUploads();
        await sink.flush();
        await finalizeMemberRunError(testMember.id, details.testCaseId, usage, error, options);
        return { status: TEST_STATUS.FAIL, error: error instanceof Error ? error.message : String(error) };
    } finally {
        disposeMemberAbort();
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
/**
 * Runs tasks over items with at most `limit` in flight; results stay in item order.
 * A rejected task is mapped to a fallback via `onTaskError` rather than rejecting the
 * whole batch, so one item's failure can't skip reconciliation of its siblings.
 *
 * When `shouldStop` is supplied and returns true, workers stop claiming further items;
 * in-flight tasks still settle, but never-started items are left `undefined` so the caller
 * can reconcile them (e.g. cancel them). Without `shouldStop` the result array is always
 * fully populated, preserving the contract existing callers rely on.
 */
async function runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    task: (item: T) => Promise<R>,
    onTaskError: (item: T, error: unknown) => Promise<R>,
    shouldStop?: () => boolean,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(limit, items.length));
    const workers = Array.from({ length: workerCount }, async () => {
        for (;;) {
            if (shouldStop?.()) {
                break;
            }
            const index = cursor;
            cursor += 1;
            if (index >= items.length) {
                break;
            }
            try {
                results[index] = await task(items[index]);
            } catch (error) {
                results[index] = await onTaskError(items[index], error);
            }
        }
    });
    await Promise.all(workers);
    return results;
}

/**
 * Defense-in-depth fallback for a login prefix that rejects despite runLoginPrefix's own
 * isolation: settle the member and report a FAIL outcome so the session still reconciles.
 */
async function settleRejectedLoginPrefix(
    login: SessionMember,
    error: unknown,
    options?: LocalBrowserRunOptions,
): Promise<{ status: string; storageState?: BrowserStorageState; projectId: string }> {
    logger.error('Login prefix rejected unexpectedly', { runId: login.id, error: getErrorMessage(error) });
    await failRunWithoutTestCase(login.id, getErrorMessage(error), options).catch(() => {});
    return { status: TEST_STATUS.FAIL, projectId: '' };
}

/**
 * Settles any session members left non-terminal after the orchestrator throws unexpectedly,
 * so a stranded member can't keep the session active forever (which blocks future runs).
 * No-op for a run that has no session or whose members are all already terminal.
 */
export async function reconcileStrandedSessionMembers(runId: string): Promise<void> {
    const run = await prisma.testRun.findUnique({
        where: { id: runId },
        select: { runSessionId: true },
    });
    if (!run?.runSessionId) {
        return;
    }
    await failActiveSessionMembers(run.runSessionId);
}

/**
 * Bounds a session's in-process parallel width (login prefixes or parallel group members) by the
 * project's max-concurrent setting, the global per-project cap, and the local browser-slot cap.
 * This is the only throttle on in-process fan-out — the dispatcher's caps gate leader claims, not
 * a running session's own concurrency — so without the local clamp one session could open more
 * browsers than the host is provisioned for.
 */
function boundSessionConcurrency(projectMaxConcurrentRuns: number | null | undefined): number {
    return Math.max(1, Math.min(
        projectMaxConcurrentRuns ?? 1,
        appConfig.runner.maxProjectConcurrentRuns,
        appConfig.runner.maxLocalBrowserRuns,
    ));
}

/** Parallelism for a SINGLE session's independent login flows. */
async function loadSessionLoginConcurrency(sessionId: string): Promise<number> {
    const session = await prisma.runSession.findUnique({
        where: { id: sessionId },
        select: { project: { select: { maxConcurrentRuns: true } } },
    });
    return boundSessionConcurrency(session?.project?.maxConcurrentRuns);
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
            await cancelRemainingMembers(members, CANCEL_REASON.USER_SINGLE);
            return;
        }
        // Login flows are independent (each opens its own browser and captures its own
        // baseline), so run them in parallel up to the project's max-concurrent setting
        // instead of serially.
        const concurrency = await loadSessionLoginConcurrency(sessionId);
        const outcomes = await runWithConcurrency(
            loginMembers,
            concurrency,
            (login) => withLoginFlowBrowserSlot(() => runLoginPrefix(login, controller, options)),
            (login, error) => settleRejectedLoginPrefix(login, error, options),
        );

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
        await cancelRemainingMembers([testMember], CANCEL_REASON.USER_SINGLE);
        return;
    }
    await runTestMemberWithBaselines(testMember, baselines, controller, options);
}

function coerceGroupFailureMode(onFailure: string | null | undefined): TestGroupFailureMode {
    return onFailure === TEST_GROUP_FAILURE_MODE.CONTINUE
        ? TEST_GROUP_FAILURE_MODE.CONTINUE
        : TEST_GROUP_FAILURE_MODE.STOP;
}

function coerceGroupExecutionMode(executionMode: string | null | undefined): TestGroupExecutionMode {
    return executionMode === TEST_GROUP_EXECUTION_MODE.PARALLEL
        ? TEST_GROUP_EXECUTION_MODE.PARALLEL
        : TEST_GROUP_EXECUTION_MODE.SEQUENTIAL;
}

/**
 * Executes a GROUP run session with multiple login sessions (Option A: baseline restore).
 * Each login-flow member runs once and its post-login storageState is captured, keyed by
 * login flow. Every member then runs in a fresh context: a test case whose primary target
 * reuses a session is seeded with that session's captured baseline, so a logout in one case
 * cannot affect later cases. Failure handling follows the group's onFailure mode (STOP skips
 * the remaining cases; CONTINUE runs them — cases depending on a failed login session simply
 * start unauthenticated). Test cases run sequentially or in parallel per the group's
 * executionMode.
 */
export async function executeGroupSession(
    sessionId: string,
    controller: AbortController,
    options?: LocalBrowserRunOptions,
): Promise<void> {
    // One lookup covers every group-level decision: failure mode, execution mode, and the
    // parallel width, avoiding repeated point queries for the same session.
    const session = await prisma.runSession.findUnique({
        where: { id: sessionId },
        select: {
            project: { select: { maxConcurrentRuns: true } },
            testGroup: { select: { onFailure: true, executionMode: true } },
        },
    });
    const mode = coerceGroupFailureMode(session?.testGroup?.onFailure);
    const executionMode = coerceGroupExecutionMode(session?.testGroup?.executionMode);
    const concurrency = boundSessionConcurrency(session?.project?.maxConcurrentRuns);
    const members = await loadOrderedMembers(sessionId);
    if (members.length === 0) {
        return;
    }

    const loginMembers = members.filter((member) => member.kind === TEST_CASE_KIND.LOGIN_FLOW);
    const testMembers = members.filter((member) => member.kind !== TEST_CASE_KIND.LOGIN_FLOW);
    const baselines = new Map<string, BrowserStorageState>();

    // The group's login flows are independent — run them in parallel, capture baselines.
    if (loginMembers.length > 0) {
        if (controller.signal.aborted) {
            await cancelRemainingMembers(members, CANCEL_REASON.USER_GROUP);
            return;
        }
        const outcomes = await runWithConcurrency(
            loginMembers,
            concurrency,
            (login) => withLoginFlowBrowserSlot(() => runLoginPrefix(login, controller, options)),
            (login, error) => settleRejectedLoginPrefix(login, error, options),
        );
        outcomes.forEach((outcome, index) => {
            if (outcome.status === TEST_STATUS.PASS && outcome.storageState) {
                baselines.set(loginMembers[index].testCaseId, outcome.storageState);
            }
        });
        // A failed login session can't authenticate its dependent cases. STOP halts the
        // group; CONTINUE lets unrelated cases proceed (dependent ones run unauthenticated).
        if (outcomes.some((outcome) => outcome.status !== TEST_STATUS.PASS) && shouldStopAfterFailure(mode)) {
            await cancelRemainingMembers(testMembers, CANCEL_REASON.LOGIN_FLOW_FAILED);
            return;
        }
    }

    if (executionMode === TEST_GROUP_EXECUTION_MODE.PARALLEL) {
        await runGroupTestMembersInParallel(testMembers, baselines, mode, concurrency, controller, options);
        return;
    }
    await runGroupTestMembersInSequence(testMembers, baselines, mode, controller, options);
}

/** Runs a group's test cases one at a time, in order; each reuses a group login session only
 * when opted in. STOP cancels the remaining cases after the first non-pass. */
async function runGroupTestMembersInSequence(
    testMembers: SessionMember[],
    baselines: Map<string, BrowserStorageState>,
    mode: TestGroupFailureMode,
    controller: AbortController,
    options?: LocalBrowserRunOptions,
): Promise<void> {
    for (let index = 0; index < testMembers.length; index += 1) {
        if (controller.signal.aborted) {
            await cancelRemainingMembers(testMembers.slice(index), CANCEL_REASON.USER_GROUP);
            return;
        }
        const result = await runTestMemberWithBaselines(testMembers[index], baselines, controller, options, true);
        if (result.status !== TEST_STATUS.PASS && shouldStopAfterFailure(mode)) {
            await cancelRemainingMembers(testMembers.slice(index + 1), CANCEL_REASON.EARLIER_CASE_FAILED);
            return;
        }
    }
}

/**
 * Runs a group's test cases concurrently, up to `concurrency` in flight, each bracketed by a
 * local browser slot so the host's cap stays honest. In STOP mode a non-pass (or a session
 * cancel) halts launching further cases; members already in flight settle, and members that
 * never started are cancelled — the closest parallel analog to sequential STOP.
 */
async function runGroupTestMembersInParallel(
    testMembers: SessionMember[],
    baselines: Map<string, BrowserStorageState>,
    mode: TestGroupFailureMode,
    concurrency: number,
    controller: AbortController,
    options?: LocalBrowserRunOptions,
): Promise<void> {
    let stopRequested = false;
    const outcomes = await runWithConcurrency(
        testMembers,
        concurrency,
        async (member) => {
            const result = await withSessionMemberBrowserSlot(
                () => runTestMemberWithBaselines(member, baselines, controller, options, true),
            );
            if (result.status !== TEST_STATUS.PASS && shouldStopAfterFailure(mode)) {
                stopRequested = true;
            }
            return result;
        },
        async () => ({ status: TEST_STATUS.FAIL } as TestResult),
        () => stopRequested || controller.signal.aborted,
    );

    const notStarted = testMembers.filter((_, index) => outcomes[index] === undefined);
    if (notStarted.length > 0) {
        const reason = controller.signal.aborted ? CANCEL_REASON.USER_GROUP : CANCEL_REASON.EARLIER_CASE_FAILED;
        await cancelRemainingMembers(notStarted, reason);
    }
}
