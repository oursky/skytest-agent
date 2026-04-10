import { printTable, printValue, type OutputFormat } from './output';
import { runTestCase } from './run-test-case';
import { createReportSessionLabel, writeRunFileReport } from './file-reporter';
import {
    parseJsonResponse,
    resolveAuthToken,
    resolveBaseUrl,
    syncProjectCatalogIfNeeded,
} from './api-client';

interface RunProjectOptions {
    projectId: string;
    displayIds: string[];
    concurrency?: number;
    controlPlaneBaseUrl?: string;
    authToken?: string;
    syncBeforeRun?: boolean;
    syncRoot?: string;
    wait: boolean;
    timeoutMs: number;
    reporter: 'console' | 'file';
    reportDir?: string;
    format: OutputFormat;
}

interface ProjectTestCaseSummary {
    id: string;
    displayId: string;
    name: string;
}

interface RunDetailResponse {
    id: string;
    status: string;
    error?: string | null;
    completedAt?: string | null;
    files?: unknown;
    events?: unknown;
}

interface ProjectRunResult {
    displayId: string;
    runId: string;
    status: string;
    error?: string | null;
}

interface FileReportEntry {
    displayId: string;
    runId: string;
    sessionDirectory: string;
    resultFile: string;
    markdownFile: string;
    screenshotsDirectory: string;
    screenshotCount: number;
}

interface ProjectRunSummary {
    projectId: string;
    wait: boolean;
    runCount: number;
    results: ProjectRunResult[];
    reporter?: {
        type: 'file';
        reports: FileReportEntry[];
    };
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

    return await parseJsonResponse<Array<{
        id: string;
        displayId: string;
        name: string;
    }>>(response, 'List project test cases');
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

async function fetchRunDetail(baseUrl: string, authToken: string, runId: string): Promise<RunDetailResponse> {
    const response = await fetch(`${baseUrl}/api/test-runs/${encodeURIComponent(runId)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });

    return await parseJsonResponse<RunDetailResponse>(response, 'Fetch run detail');
}

async function maybeWriteFileReport(options: {
    reporter: 'console' | 'file';
    wait: boolean;
    reportDir?: string;
    reportSessionLabel?: string;
    baseUrl: string;
    authToken: string;
    runResult: ProjectRunResult;
}): Promise<FileReportEntry | null> {
    if (!options.wait || options.reporter !== 'file') {
        return null;
    }

    const detail = await fetchRunDetail(options.baseUrl, options.authToken, options.runResult.runId);
    const report = await writeRunFileReport({
        runId: options.runResult.runId,
        reportDir: options.reportDir,
        sessionLabel: options.reportSessionLabel,
        caseId: options.runResult.displayId,
        summary: options.runResult,
        detail,
    });

    return {
        displayId: options.runResult.displayId,
        runId: options.runResult.runId,
        sessionDirectory: report.sessionDirectory,
        resultFile: report.resultFile,
        markdownFile: report.markdownFile,
        screenshotsDirectory: report.screenshotsDirectory,
        screenshotCount: report.screenshotCount,
    };
}

export async function runProject(options: RunProjectOptions): Promise<ProjectRunSummary> {
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

    const runResults: ProjectRunResult[] = [];
    const reportEntries: FileReportEntry[] = [];
    const reportSessionLabel = options.wait && options.reporter === 'file'
        ? createReportSessionLabel()
        : undefined;

    const effectiveConcurrency = Math.max(1, options.concurrency ?? 1);

    if (effectiveConcurrency === 1) {
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
                reporter: options.reporter,
                reportDir: options.reportDir,
                format: options.format,
            });

            const normalizedResult: ProjectRunResult = {
                displayId: runResult.displayId,
                runId: runResult.runId,
                status: runResult.status,
                error: runResult.error ?? null,
            };
            runResults.push(normalizedResult);

            const reportEntry = await maybeWriteFileReport({
                reporter: options.reporter,
                wait: options.wait,
                reportDir: options.reportDir,
                reportSessionLabel,
                baseUrl,
                authToken,
                runResult: normalizedResult,
            });
            if (reportEntry) {
                reportEntries.push(reportEntry);
            }

            if (options.wait && runResult.status !== 'PASS') {
                break;
            }
        }
    } else {
        const resultsByIndex: Array<ProjectRunResult | null> = new Array(displayIds.length).fill(null);
        let nextIndex = 0;
        let shouldStopDispatch = false;

        const worker = async (): Promise<void> => {
            while (true) {
                const currentIndex = nextIndex;
                if (currentIndex >= displayIds.length) {
                    return;
                }
                nextIndex += 1;

                if (shouldStopDispatch) {
                    return;
                }

                const displayId = displayIds[currentIndex];
                const runResult = await runTestCase({
                    displayId,
                    projectId: options.projectId,
                    controlPlaneBaseUrl: baseUrl,
                    authToken,
                    syncBeforeRun: false,
                    syncRoot: options.syncRoot,
                    wait: options.wait,
                    timeoutMs: options.timeoutMs,
                    reporter: options.reporter,
                    reportDir: options.reportDir,
                    format: options.format,
                });

                resultsByIndex[currentIndex] = {
                    displayId: runResult.displayId,
                    runId: runResult.runId,
                    status: runResult.status,
                    error: runResult.error ?? null,
                };

                if (options.wait && runResult.status !== 'PASS') {
                    shouldStopDispatch = true;
                    return;
                }
            }
        };

        const workerCount = Math.min(effectiveConcurrency, displayIds.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));

        for (const result of resultsByIndex) {
            if (!result) {
                break;
            }
            runResults.push(result);

            const reportEntry = await maybeWriteFileReport({
                reporter: options.reporter,
                wait: options.wait,
                reportDir: options.reportDir,
                reportSessionLabel,
                baseUrl,
                authToken,
                runResult: result,
            });
            if (reportEntry) {
                reportEntries.push(reportEntry);
            }

            if (options.wait && result.status !== 'PASS') {
                break;
            }
        }
    }

    const summary: ProjectRunSummary = {
        projectId: options.projectId,
        wait: options.wait,
        runCount: runResults.length,
        results: runResults,
    };

    if (options.wait && options.reporter === 'file') {
        summary.reporter = {
            type: 'file',
            reports: reportEntries,
        };
    }

    return summary;
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

        if (summary.reporter?.type === 'file') {
            for (const report of summary.reporter.reports) {
                printValue(
                    `${report.displayId} (${report.runId})\n  session: ${report.sessionDirectory}\n  json: ${report.resultFile}\n  md: ${report.markdownFile}\n  screenshots: ${report.screenshotCount} @ ${report.screenshotsDirectory}`,
                    options.format,
                );
            }
        }
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
