import { expect as playwrightExpect } from '@playwright/test';
import { Page } from 'playwright';
import { config } from '@/config/app';
import { PlaywrightCodeError, getErrorMessage } from '@/lib/core/errors';
import { createSafePage, validatePlaywrightCode } from '@/lib/runtime/playwright-code-sandbox';
import { splitPlaywrightCodeStatements, summarizePlaywrightCodeStatement } from '@/lib/runtime/playwright-code-trace';
import { TestStep } from '@/types';
import { Script, createContext } from 'node:vm';
import path from 'node:path';

export type RuntimeLogger = (
    message: string,
    level?: 'info' | 'error' | 'success',
    browserId?: string
) => void;

export interface PlaywrightCodeStepContext {
    allowedFilePaths: ReadonlySet<string>;
    allowedTestCaseDir?: string;
    stepFiles: Record<string, string>;
}

export interface PlaywrightCodeExecutionOptions {
    code: string;
    page: Page;
    stepIndex: number;
    log: RuntimeLogger;
    browserId?: string;
    targetLabel: string;
    captureScreenshot: (label: string) => Promise<void>;
    stepContext?: PlaywrightCodeStepContext;
    resolvedVariables?: Record<string, string>;
    resolvedConfigFiles?: Record<string, string>;
}

export async function executePlaywrightCode(
    options: PlaywrightCodeExecutionOptions
): Promise<void> {
    const {
        code,
        page,
        stepIndex,
        log,
        browserId,
        targetLabel,
        captureScreenshot,
        stepContext,
        resolvedVariables,
        resolvedConfigFiles,
    } = options;

    const timeoutMs = config.test.playwrightCode.statementTimeoutMs;
    const syncTimeoutMs = config.test.playwrightCode.syncTimeoutMs;
    const expectTimeoutMs = config.test.playwrightCode.expectTimeoutMs;
    const configuredExpect = playwrightExpect.configure({ timeout: expectTimeoutMs });
    const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
    const trimmedCode = code.trim();
    if (!trimmedCode) {
        log(`[Step ${stepIndex + 1}] No executable statements found`, 'info', browserId);
        return;
    }

    try {
        new AsyncFunction('page', code);
    } catch (syntaxError) {
        throw new PlaywrightCodeError(
            `Syntax error in code at step ${stepIndex + 1}: ${getErrorMessage(syntaxError)}`,
            stepIndex,
            code,
            syntaxError instanceof Error ? syntaxError : undefined
        );
    }

    validatePlaywrightCode(code, stepIndex);
    const statements = splitPlaywrightCodeStatements(trimmedCode);
    if (statements.length === 0) {
        log(`[Step ${stepIndex + 1}] No executable statements found`, 'info', browserId);
        return;
    }

    const safePage = createSafePage(page, stepIndex, code, {
        allowedFilePaths: stepContext?.allowedFilePaths ?? new Set<string>(),
        allowedTestCaseDir: stepContext?.allowedTestCaseDir
    });
    const stepFiles = stepContext?.stepFiles ?? {};
    const vars = resolvedVariables || {};
    const configFiles = resolvedConfigFiles || {};
    const testFiles = configFiles;

    type TimeoutHandle = ReturnType<typeof setTimeout>;
    type IntervalHandle = ReturnType<typeof setInterval>;

    const timeouts = new Set<TimeoutHandle>();
    const intervals = new Set<IntervalHandle>();

    const setTimeoutWrapped = (...args: Parameters<typeof setTimeout>): TimeoutHandle => {
        const handle = setTimeout(...args) as TimeoutHandle;
        timeouts.add(handle);
        return handle;
    };

    const clearTimeoutWrapped = (handle: TimeoutHandle): void => {
        timeouts.delete(handle);
        clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
    };

    const setIntervalWrapped = (...args: Parameters<typeof setInterval>): IntervalHandle => {
        const handle = setInterval(...args) as IntervalHandle;
        intervals.add(handle);
        return handle;
    };

    const clearIntervalWrapped = (handle: IntervalHandle): void => {
        intervals.delete(handle);
        clearInterval(handle as Parameters<typeof clearInterval>[0]);
    };

    const cleanupTimers = (): void => {
        for (const handle of Array.from(intervals)) {
            clearIntervalWrapped(handle);
        }
        for (const handle of Array.from(timeouts)) {
            clearTimeoutWrapped(handle);
        }
    };

    const context = createContext(
        {
            page: safePage,
            expect: configuredExpect,
            setTimeout: setTimeoutWrapped,
            clearTimeout: clearTimeoutWrapped,
            setInterval: setIntervalWrapped,
            clearInterval: clearIntervalWrapped,
            vars,
            testFiles,
            configFiles,
            stepFiles,
            files: stepFiles,
        },
        { codeGeneration: { strings: false, wasm: false } }
    );

    log(`[Step ${stepIndex + 1}] Executing Playwright code block...`, 'info', browserId);

    const timeoutSeconds = Math.ceil(timeoutMs / 1000);

    try {
        for (const statement of statements) {
            const lineLabel = statement.lineStart === statement.lineEnd
                ? `line ${statement.lineStart}`
                : `lines ${statement.lineStart}-${statement.lineEnd}`;
            const statementSummary = summarizePlaywrightCodeStatement(statement.code);

            log(
                `[Step ${stepIndex + 1}] Executing Playwright ${lineLabel}: ${statementSummary}`,
                'info',
                browserId
            );

            let timerHandle: TimeoutHandle | null = null;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timerHandle = setTimeoutWrapped(
                    () => reject(new Error(`Playwright code execution timed out (${timeoutSeconds}s)`)),
                    timeoutMs
                );
            });

            try {
                const script = new Script(`(async () => { ${statement.code} })()`);
                const result = script.runInContext(context, { timeout: syncTimeoutMs }) as Promise<unknown>;
                await Promise.race([result, timeoutPromise]);
                await captureScreenshot(`[${targetLabel}] Step ${stepIndex + 1} ${lineLabel}`);
            } finally {
                if (timerHandle) {
                    clearTimeoutWrapped(timerHandle);
                }
            }
        }
    } catch (error) {
        const errorMessage = getErrorMessage(error);
        log(
            `[Step ${stepIndex + 1}] Playwright code error: ${errorMessage}`,
            'error',
            browserId
        );
        await captureScreenshot(`[${targetLabel}] Step ${stepIndex + 1} Error`);
        throw new PlaywrightCodeError(
            `Playwright code execution failed at step ${stepIndex + 1}: ${errorMessage}`,
            stepIndex,
            trimmedCode,
            error instanceof Error ? error : undefined
        );
    } finally {
        cleanupTimers();
    }
}

export function resolvePlaywrightCodeStepContext(
    step: TestStep,
    stepFilesById: Record<string, string>,
    allowedTestCaseDir?: string
): PlaywrightCodeStepContext {
    const stepFiles: Record<string, string> = {};

    if (!step.files || step.files.length === 0) {
        return {
            stepFiles,
            allowedFilePaths: new Set<string>(),
            allowedTestCaseDir,
        };
    }

    for (const fileId of step.files) {
        const filePath = stepFilesById[fileId];
        if (!filePath) continue;
        stepFiles[fileId] = filePath;
    }

    const allowedFilePaths = new Set(Object.values(stepFiles).map((filePath) => path.resolve(filePath)));

    return {
        stepFiles,
        allowedFilePaths,
        allowedTestCaseDir,
    };
}
