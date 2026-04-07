import { type OutputFormat, printValue } from './output';

interface DispatchResponse {
    runId: string;
    status: string;
    requiredCapability?: string | null;
    requestedDeviceId?: string | null;
    requestedRunnerId?: string | null;
    instanceId?: string | null;
    instanceType?: string | null;
    instanceName?: string | null;
}

interface RunDetailResponse {
    id: string;
    status: string;
    error?: string | null;
    completedAt?: string | null;
}

interface RunTestCaseOptions {
    displayId: string;
    projectId: string;
    controlPlaneBaseUrl?: string;
    authToken?: string;
    syncBeforeRun?: boolean;
    syncRoot?: string;
    wait: boolean;
    timeoutMs: number;
    format: OutputFormat;
}

interface TeamAiKeyStatusResponse {
    hasKey: boolean;
}

function normalizeBaseUrl(input: string): string {
    return input.endsWith('/') ? input.slice(0, -1) : input;
}

function resolveBaseUrl(value?: string): string {
    const fallback = process.env.SKYTEST_BASE_URL ?? process.env.RUNNER_CONTROL_PLANE_URL ?? 'http://127.0.0.1:3000';
    return normalizeBaseUrl((value ?? fallback).trim());
}

function resolveAuthToken(value?: string): string {
    const token = value ?? process.env.SKYTEST_API_KEY ?? process.env.SKYTEST_TOKEN;
    if (!token || !token.trim()) {
        throw new Error('Missing auth token. Set --api-key/--token or SKYTEST_API_KEY.');
    }
    return token.trim();
}

async function parseJsonResponse<T>(response: Response, context: string): Promise<T> {
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`${context} failed with ${response.status}: ${errorBody}`);
    }

    return await response.json() as T;
}

async function resolveTestCaseByDisplayId(
    baseUrl: string,
    authToken: string,
    projectId: string,
    displayId: string,
): Promise<{ id: string; displayId: string; name: string; url: string; prompt: string | null; steps: unknown; browserConfig: unknown; }> {
    const response = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/test-cases`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });

    const testCases = await parseJsonResponse<Array<{
        id: string;
        displayId: string;
        name: string;
        url: string;
        prompt: string | null;
        steps: unknown;
        browserConfig: unknown;
    }>>(response, 'List test cases');

    const matched = testCases.find((testCase) => testCase.displayId === displayId);
    if (!matched) {
        throw new Error(`Test case ${displayId} not found in project ${projectId}.`);
    }

    const detailResponse = await fetch(`${baseUrl}/api/test-cases/${encodeURIComponent(matched.id)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });

    return await parseJsonResponse<{
        id: string;
        displayId: string;
        name: string;
        url: string;
        prompt: string | null;
        steps: unknown;
        browserConfig: unknown;
    }>(detailResponse, 'Fetch test case detail');
}

function parseSteps(rawSteps: unknown): unknown[] {
    if (Array.isArray(rawSteps)) {
        return rawSteps;
    }

    if (typeof rawSteps === 'string' && rawSteps.trim()) {
        try {
            const parsed = JSON.parse(rawSteps) as unknown;
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
}

function testCaseUsesAiAction(steps: unknown): boolean {
    return parseSteps(steps).some((step) => {
        if (!step || typeof step !== 'object') {
            return false;
        }

        const type = (step as { type?: unknown }).type;
        return type === 'ai-action';
    });
}

async function ensureTeamAiKeyConfiguredForAiStepsIfNeeded(
    baseUrl: string,
    authToken: string,
    projectId: string,
    testCase: { displayId: string; steps: unknown },
): Promise<void> {
    if (!testCaseUsesAiAction(testCase.steps)) {
        return;
    }

    const projectResponse = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });

    const project = await parseJsonResponse<{ teamId: string }>(projectResponse, 'Fetch project detail');
    const teamResponse = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(project.teamId)}/ai-key`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });

    const teamAiKeyStatus = await parseJsonResponse<TeamAiKeyStatusResponse>(teamResponse, 'Fetch team AI key status');
    if (teamAiKeyStatus.hasKey) {
        return;
    }

    throw new Error(
        `Test case ${testCase.displayId} uses ai-action steps but team AI key is not configured. `
        + 'Configure Team AI key in SkyTest Team Settings, then rerun.',
    );
}

async function syncProjectCatalogIfNeeded(
    baseUrl: string,
    authToken: string,
    projectId: string,
    options: Pick<RunTestCaseOptions, 'syncBeforeRun' | 'syncRoot'>,
): Promise<void> {
    if (options.syncBeforeRun === false) {
        return;
    }

    const payload = options.syncRoot ? { root: options.syncRoot } : {};
    const response = await fetch(
        `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/test-cases/sync`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify(payload),
        },
    );

    await parseJsonResponse<{ imported: number; updated: number }>(response, 'Sync project catalog');
}

async function dispatchTestRun(
    baseUrl: string,
    authToken: string,
    testCase: {
        id: string;
        name: string;
        url: string;
        prompt: string | null;
        steps: unknown;
        browserConfig: unknown;
    },
): Promise<DispatchResponse> {
    const response = await fetch(`${baseUrl}/api/test-runs/dispatch`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
            testCaseId: testCase.id,
            name: testCase.name,
            url: testCase.url,
            prompt: testCase.prompt,
            steps: testCase.steps,
            browserConfig: testCase.browserConfig,
        }),
    });

    return await parseJsonResponse<DispatchResponse>(response, 'Dispatch run');
}

async function fetchRunDetail(baseUrl: string, authToken: string, runId: string): Promise<RunDetailResponse> {
    const response = await fetch(`${baseUrl}/api/test-runs/${encodeURIComponent(runId)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });

    return await parseJsonResponse<RunDetailResponse>(response, 'Fetch run detail');
}

function isRunTerminalStatus(status: string): boolean {
    return status === 'PASS' || status === 'FAIL' || status === 'CANCELLED';
}

async function waitForRunTerminalStatus(
    baseUrl: string,
    authToken: string,
    runId: string,
    timeoutMs: number,
    requiredCapability?: string | null,
): Promise<RunDetailResponse> {
    const startedAt = Date.now();
    let latestDetail: RunDetailResponse | null = null;

    while (true) {
        const elapsedBeforeFetch = Date.now() - startedAt;
        if (elapsedBeforeFetch >= timeoutMs) {
            break;
        }

        const detail = await fetchRunDetail(baseUrl, authToken, runId);
        latestDetail = detail;
        if (isRunTerminalStatus(detail.status)) {
            return detail;
        }

        const elapsedAfterFetch = Date.now() - startedAt;
        const remainingMs = timeoutMs - elapsedAfterFetch;
        if (remainingMs <= 0) {
            break;
        }

        await new Promise((resolve) => setTimeout(resolve, Math.min(1200, remainingMs)));
    }

    const lastStatus = latestDetail?.status ?? 'UNKNOWN';
    if (lastStatus === 'QUEUED' || lastStatus === 'PREPARING') {
        const capabilityHint = requiredCapability?.toUpperCase() === 'BROWSER'
            ? 'This usually means no browser worker is currently claiming runs. For local development, use `make dev` (recommended) or run both `npm run runner:maintenance` and `npm run --workspace @skytest/web browser:worker`.'
            : 'This usually means no compatible worker is currently claiming runs.';
        throw new Error(`Run ${runId} stayed ${lastStatus} for ${timeoutMs}ms without being claimed. ${capabilityHint}`);
    }

    throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms (last status: ${lastStatus}).`);
}

export async function runTestCase(options: RunTestCaseOptions): Promise<{
    displayId: string;
    projectId: string;
    runId: string;
    status: string;
    wait: boolean;
    completedAt?: string | null;
    error?: string | null;
}> {
    const baseUrl = resolveBaseUrl(options.controlPlaneBaseUrl);
    const authToken = resolveAuthToken(options.authToken);

    await syncProjectCatalogIfNeeded(baseUrl, authToken, options.projectId, {
        syncBeforeRun: options.syncBeforeRun,
        syncRoot: options.syncRoot,
    });

    const testCase = await resolveTestCaseByDisplayId(baseUrl, authToken, options.projectId, options.displayId);
    await ensureTeamAiKeyConfiguredForAiStepsIfNeeded(baseUrl, authToken, options.projectId, testCase);
    const dispatched = await dispatchTestRun(baseUrl, authToken, testCase);

    if (!options.wait) {
        return {
            displayId: options.displayId,
            projectId: options.projectId,
            runId: dispatched.runId,
            status: dispatched.status,
            wait: false,
        };
    }

    const finalDetail = await waitForRunTerminalStatus(
        baseUrl,
        authToken,
        dispatched.runId,
        options.timeoutMs,
        dispatched.requiredCapability,
    );
    return {
        displayId: options.displayId,
        projectId: options.projectId,
        runId: dispatched.runId,
        status: finalDetail.status,
        wait: true,
        completedAt: finalDetail.completedAt ?? null,
        error: finalDetail.error ?? null,
    };
}

function buildRunFailureMessage(result: {
    runId: string;
    status: string;
    error?: string | null;
}): string {
    const baseMessage = `Run ${result.runId} finished with status ${result.status}${result.error ? `: ${result.error}` : ''}`;
    if (!result.error) {
        return baseMessage;
    }

    const aiAuthFailure = /failed to call ai model service|incorrect api key provided|invalid_api_key/i.test(result.error);
    if (!aiAuthFailure) {
        return baseMessage;
    }

    return `${baseMessage}\nHint: this run uses ai-action steps and the team AI provider credentials appear invalid. Update Team AI settings and retry.`;
}

export async function runRunTestCaseCommand(options: RunTestCaseOptions): Promise<void> {
    const result = await runTestCase(options);

    if (options.format === 'json') {
        printValue(result, options.format);
        if (result.wait && result.status !== 'PASS') {
            throw new Error(buildRunFailureMessage(result));
        }
        return;
    }

    printValue(`run ${result.runId} for ${result.displayId} in project ${result.projectId}`, options.format);
    printValue(JSON.stringify(result, null, 2), options.format);

    if (result.wait && result.status !== 'PASS') {
        throw new Error(buildRunFailureMessage(result));
    }
}
