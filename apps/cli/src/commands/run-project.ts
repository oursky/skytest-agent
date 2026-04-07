import { printTable, printValue, type OutputFormat } from './output';
import { runTestCase } from './run-test-case';

interface RunProjectOptions {
    projectId: string;
    displayIds: string[];
    controlPlaneBaseUrl?: string;
    authToken?: string;
    syncBeforeRun?: boolean;
    syncRoot?: string;
    wait: boolean;
    timeoutMs: number;
    format: OutputFormat;
}

interface ProjectTestCaseSummary {
    id: string;
    displayId: string;
    name: string;
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

async function listProjectTestCases(
    baseUrl: string,
    authToken: string,
    projectId: string,
): Promise<ProjectTestCaseSummary[]> {
    const response = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/test-cases`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });

    const payload = await parseJsonResponse<Array<{
        id: string;
        displayId: string;
        name: string;
    }>>(response, 'List project test cases');

    return payload;
}

function selectDisplayIds(allCases: ProjectTestCaseSummary[], requestedDisplayIds: string[]): string[] {
    if (requestedDisplayIds.length === 0) {
        return allCases
            .map((testCase) => testCase.displayId)
            .filter((displayId): displayId is string => Boolean(displayId && displayId.trim()));
    }

    const available = new Set(allCases.map((testCase) => testCase.displayId));
    const missing = requestedDisplayIds.filter((displayId) => !available.has(displayId));
    if (missing.length > 0) {
        throw new Error(`Requested display IDs not found in project: ${missing.join(', ')}`);
    }

    return requestedDisplayIds;
}

async function syncProjectCatalogIfNeeded(
    baseUrl: string,
    authToken: string,
    options: Pick<RunProjectOptions, 'projectId' | 'syncBeforeRun' | 'syncRoot'>,
): Promise<void> {
    if (options.syncBeforeRun === false) {
        return;
    }

    const payload = options.syncRoot ? { root: options.syncRoot } : {};
    const response = await fetch(
        `${baseUrl}/api/projects/${encodeURIComponent(options.projectId)}/test-cases/sync`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify(payload),
        },
    );

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Sync project catalog failed with ${response.status}: ${errorBody}`);
    }
}

export async function runProject(options: RunProjectOptions): Promise<{
    projectId: string;
    wait: boolean;
    runCount: number;
    results: Array<{
        displayId: string;
        runId: string;
        status: string;
        error?: string | null;
    }>;
}> {
    const baseUrl = resolveBaseUrl(options.controlPlaneBaseUrl);
    const authToken = resolveAuthToken(options.authToken);

    await syncProjectCatalogIfNeeded(baseUrl, authToken, {
        projectId: options.projectId,
        syncBeforeRun: options.syncBeforeRun,
        syncRoot: options.syncRoot,
    });

    const allCases = await listProjectTestCases(baseUrl, authToken, options.projectId);
    const displayIds = selectDisplayIds(allCases, options.displayIds);

    if (displayIds.length === 0) {
        throw new Error(`No runnable test cases found in project ${options.projectId}.`);
    }

    const runResults: Array<{
        displayId: string;
        runId: string;
        status: string;
        error?: string | null;
    }> = [];

    for (const displayId of displayIds) {
        const runResult = await runTestCase({
            displayId,
            projectId: options.projectId,
            controlPlaneBaseUrl: baseUrl,
            authToken,
            syncBeforeRun: false,
            syncRoot: options.syncRoot,
            wait: options.wait,
            timeoutMs: options.timeoutMs,
            format: options.format,
        });

        runResults.push({
            displayId: runResult.displayId,
            runId: runResult.runId,
            status: runResult.status,
            error: runResult.error ?? null,
        });

        if (options.wait && runResult.status !== 'PASS') {
            break;
        }
    }

    return {
        projectId: options.projectId,
        wait: options.wait,
        runCount: runResults.length,
        results: runResults,
    };
}

export async function runRunProjectCommand(options: RunProjectOptions): Promise<void> {
    const summary = await runProject(options);

    if (options.format === 'json') {
        printValue(summary, options.format);
    } else {
        const rows = summary.results.map((result) => [
            result.displayId,
            result.status,
            result.runId,
            result.error ? result.error : '-',
        ]);
        printTable(['DISPLAY ID', 'STATUS', 'RUN ID', 'ERROR'], rows);
    }

    if (options.wait) {
        const failed = summary.results.find((result) => result.status !== 'PASS');
        if (failed) {
            const baseMessage = `Project run stopped at ${failed.displayId} with status ${failed.status}${failed.error ? `: ${failed.error}` : ''}`;
            const aiAuthFailure = failed.error && /failed to call ai model service|incorrect api key provided|invalid_api_key/i.test(failed.error);
            if (aiAuthFailure) {
                throw new Error(`${baseMessage}\nHint: at least one ai-action step failed due to invalid team AI provider credentials. Update Team AI settings and retry.`);
            }

            throw new Error(baseMessage);
        }
    }
}
