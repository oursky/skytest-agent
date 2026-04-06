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
    wait: boolean;
    timeoutMs: number;
    format: OutputFormat;
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
): Promise<RunDetailResponse> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const detail = await fetchRunDetail(baseUrl, authToken, runId);
        if (isRunTerminalStatus(detail.status)) {
            return detail;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms.`);
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

    const testCase = await resolveTestCaseByDisplayId(baseUrl, authToken, options.projectId, options.displayId);
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

    const finalDetail = await waitForRunTerminalStatus(baseUrl, authToken, dispatched.runId, options.timeoutMs);
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

export async function runRunTestCaseCommand(options: RunTestCaseOptions): Promise<void> {
    const result = await runTestCase(options);

    if (options.format === 'json') {
        printValue(result, options.format);
        if (result.wait && result.status !== 'PASS') {
            throw new Error(`Run ${result.runId} finished with status ${result.status}${result.error ? `: ${result.error}` : ''}`);
        }
        return;
    }

    printValue(`run ${result.runId} for ${result.displayId} in project ${result.projectId}`, options.format);
    printValue(JSON.stringify(result, null, 2), options.format);

    if (result.wait && result.status !== 'PASS') {
        throw new Error(`Run ${result.runId} finished with status ${result.status}${result.error ? `: ${result.error}` : ''}`);
    }
}
