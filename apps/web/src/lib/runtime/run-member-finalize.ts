import { InvalidAiApiKeyError } from '@/lib/core/errors';
import { TEST_STATUS, type TestResult } from '@/types';
import {
    cancelRun,
    completeRun,
    failRun,
    type LocalBrowserRunOptions,
    type RunUsageContext,
} from '@/lib/runtime/local-browser-runner-lifecycle';

/**
 * Routes a member run's TestResult to the matching terminal lifecycle transition.
 * Shared by the single-run executor and the multi-member session orchestrator.
 */
export async function finalizeMemberRunResult(
    runId: string,
    testCaseId: string,
    usage: RunUsageContext,
    result: TestResult,
    options?: LocalBrowserRunOptions,
): Promise<void> {
    const resultSummary = JSON.stringify(result);
    if (result.status === TEST_STATUS.PASS) {
        await completeRun(runId, testCaseId, usage, resultSummary, options);
        return;
    }
    if (result.status === TEST_STATUS.CANCELLED) {
        await cancelRun(runId, testCaseId, usage, resultSummary, options);
        return;
    }
    await failRun(runId, testCaseId, usage, result.error ?? 'Run failed', resultSummary, options);
}

export async function finalizeMemberRunError(
    runId: string,
    testCaseId: string,
    usage: RunUsageContext,
    error: unknown,
    options?: LocalBrowserRunOptions,
): Promise<void> {
    // UI localizes via errorCode (see ResultStatus.tsx). This fallback string is
    // written to DB and surfaces only where errorCode branching is absent.
    const errorMessage = error instanceof InvalidAiApiKeyError
        ? 'Team AI key format invalid. Re-save key in Team Settings.'
        : error instanceof Error
            ? error.message
            : String(error);
    await failRun(runId, testCaseId, usage, errorMessage, undefined, options);
}
