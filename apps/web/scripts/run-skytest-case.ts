import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'js-yaml';
import { prisma } from '../src/lib/core/prisma';
import { startLocalBrowserRun } from '../src/lib/runtime/local-browser-runner';
import { TEST_STATUS, type RunStatus } from '../src/types/status';
import type { ResolvedConfig } from '../src/types/test';
import type { SkytestRuntimeConfigFile } from '../src/types/runtime-config';

let activeRunId: string | null = null;

function parseMaybeJson<T>(value: string | null): T | undefined {
    if (!value) {
        return undefined;
    }

    try {
        return JSON.parse(value) as T;
    } catch {
        return undefined;
    }
}

function isTerminalStatus(status: RunStatus | string): boolean {
    return status === TEST_STATUS.PASS || status === TEST_STATUS.FAIL || status === TEST_STATUS.CANCELLED;
}

async function waitForTerminal(runId: string, timeoutMs = 12 * 60 * 1000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const run = await prisma.testRun.findUnique({
            where: { id: runId },
            select: { id: true, status: true, error: true, result: true, completedAt: true },
        });

        if (!run) {
            throw new Error(`Run ${runId} disappeared`);
        }

        if (isTerminalStatus(run.status)) {
            return run;
        }

        await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    throw new Error(`Timed out waiting for run ${runId}`);
}

async function forceFailRunIfNeeded(runId: string, reason: string) {
    const current = await prisma.testRun.findUnique({
        where: { id: runId },
        select: { status: true },
    });

    if (!current || isTerminalStatus(current.status)) {
        return;
    }

    await prisma.testRun.update({
        where: { id: runId },
        data: {
            status: TEST_STATUS.FAIL,
            result: TEST_STATUS.FAIL,
            error: reason,
            completedAt: new Date(),
        },
    });
}

function formatUnknownError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }

    return String(error);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeout: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}

process.on('uncaughtException', async (error) => {
    try {
        if (activeRunId) {
            await forceFailRunIfNeeded(activeRunId, `Uncaught exception: ${formatUnknownError(error)}`);
        }
    } catch (forceFailError) {
        console.error('Failed to mark run as failed after uncaught exception', forceFailError);
    } finally {
        console.error(error);
        process.exit(1);
    }
});

process.on('unhandledRejection', async (reason) => {
    try {
        if (activeRunId) {
            await forceFailRunIfNeeded(activeRunId, `Unhandled rejection: ${formatUnknownError(reason)}`);
        }
    } catch (forceFailError) {
        console.error('Failed to mark run as failed after unhandled rejection', forceFailError);
    } finally {
        console.error(reason);
        process.exit(1);
    }
});

function resolveRunTimeoutMs(): number {
    const parsed = Number(process.env.RUN_TIMEOUT_MS ?? 600000);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 600000;
    }

    return parsed;
}

async function main() {
    const displayId = process.argv[2];
    if (!displayId) {
        throw new Error('Usage: npx tsx apps/web/scripts/run-skytest-case.ts <DISPLAY_ID>');
    }

    const testCase = await prisma.testCase.findFirst({
        where: { displayId },
        include: {
            project: {
                include: {
                    team: true,
                },
            },
            files: true,
        },
    });

    if (!testCase) {
        throw new Error(`Test case ${displayId} not found`);
    }

    const skytestYamlPath = path.join(process.cwd(), '.case-studies', 'case-study-app', '.skytest', 'skytest.yaml');
    let runtimeEnvVars: Record<string, string> = {};
    try {
        const raw = await readFile(skytestYamlPath, 'utf8');
        const parsed = load(raw) as SkytestRuntimeConfigFile;
        if (parsed?.runtime?.env && typeof parsed.runtime.env === 'object') {
            runtimeEnvVars = parsed.runtime.env;
        }
    } catch {
        // runtime env not available — vars will rely on DB configs or fail gracefully
    }

    const resolvedConfigurations: ResolvedConfig[] = Object.entries(runtimeEnvVars).map(([name, value]) => ({
        name,
        type: 'VARIABLE' as const,
        value,
        source: 'project' as const,
    }));

    const configurationSnapshot = JSON.stringify({
        name: testCase.name,
        displayId: testCase.displayId,
        url: testCase.url,
        prompt: testCase.prompt,
        steps: parseMaybeJson(testCase.steps),
        browserConfig: parseMaybeJson(testCase.browserConfig),
        testCaseId: testCase.id,
        resolvedConfigurations,
    });

    const run = await prisma.testRun.create({
        data: {
            testCaseId: testCase.id,
            status: TEST_STATUS.PREPARING,
            configurationSnapshot,
            requiredCapability: 'BROWSER',
            requiredRunnerKind: null,
            startedAt: new Date(),
            triggeredByEmail: 'local-script@debug',
        },
    });

    activeRunId = run.id;

    console.log(`created run ${run.id} for ${displayId}`);

    const timeoutMs = resolveRunTimeoutMs();

    try {
        await withTimeout(startLocalBrowserRun(run.id), timeoutMs, 'startLocalBrowserRun');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await forceFailRunIfNeeded(run.id, `In-repo runner crashed: ${message}`);
        throw error;
    }

    let finalRun;
    try {
        finalRun = await waitForTerminal(run.id, timeoutMs);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await forceFailRunIfNeeded(run.id, `In-repo runner timeout: ${message}`);
        throw error;
    }

    const events = await prisma.testRunEvent.findMany({
        where: { runId: run.id },
        orderBy: { sequence: 'asc' },
        select: {
            sequence: true,
            kind: true,
            message: true,
            payload: true,
            artifactKey: true,
            createdAt: true,
        },
    });

    const lastEvents = events.slice(Math.max(0, events.length - 30));

    console.log(
        JSON.stringify(
            {
                displayId,
                runId: run.id,
                status: finalRun.status,
                error: finalRun.error,
                completedAt: finalRun.completedAt,
                eventCount: events.length,
                lastEvents,
            },
            null,
            2,
        ),
    );
}

void main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
