import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../src/lib/core/prisma';
import { encrypt } from '../../src/lib/security/crypto';
import { BROWSER_EXECUTION_CAPABILITY } from '../../src/lib/runners/constants';

if (process.env.SKYTEST_BROWSER_WORKER !== 'true') {
    // This must be set before the dynamic import below so app config resolves worker mode correctly.
    process.env.SKYTEST_BROWSER_WORKER = 'true';
}

const TERMINAL_STATUSES = new Set(['PASS', 'FAIL', 'CANCELLED']);
const ACTIVE_STATUSES = new Set(['QUEUED', 'PREPARING', 'RUNNING']);

function parseBoundedIntEnv(input: {
    name: string;
    fallback: number;
    min: number;
    max: number;
}): number {
    const raw = Number.parseInt(process.env[input.name] ?? '', 10);
    if (!Number.isFinite(raw)) {
        return input.fallback;
    }
    return Math.min(input.max, Math.max(input.min, raw));
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[rank];
}

async function ensureParentDirectory(filePath: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
    const { dispatchQueuedBrowserRuns } = await import('../../src/lib/runtime/browser-run-dispatcher');
    const { getActiveLocalBrowserRunIds } = await import('../../src/lib/runtime/local-browser-runner');
    const runSeed = `load-gate-browser-${Date.now()}`;
    const targetUrl = process.env.LOAD_GATE_BROWSER_URL?.trim();
    const metricsFilePath = process.env.LOAD_GATE_BROWSER_METRICS_FILE ?? '/tmp/skytest-browser-gate-metrics.json';
    const runCount = parseBoundedIntEnv({
        name: 'LOAD_GATE_BROWSER_RUN_COUNT',
        fallback: 20,
        min: 1,
        max: 300,
    });
    const pollIntervalMs = parseBoundedIntEnv({
        name: 'LOAD_GATE_BROWSER_POLL_INTERVAL_MS',
        fallback: 250,
        min: 50,
        max: 5_000,
    });
    const timeoutMs = parseBoundedIntEnv({
        name: 'LOAD_GATE_BROWSER_TIMEOUT_MS',
        fallback: 300_000,
        min: 10_000,
        max: 1_800_000,
    });
    const orphanPreparingRequeueAfterMs = parseBoundedIntEnv({
        name: 'LOAD_GATE_BROWSER_ORPHAN_REQUEUE_AFTER_MS',
        fallback: 30_000,
        min: 5_000,
        max: 300_000,
    });
    const dispatchBatchSize = parseBoundedIntEnv({
        name: 'LOAD_GATE_BROWSER_DISPATCH_BATCH',
        fallback: runCount,
        min: 1,
        max: 300,
    });

    const startedAtMs = Date.now();

    const user = await prisma.user.create({
        data: {
            authId: `${runSeed}-auth`,
            email: `${runSeed}@example.invalid`,
        },
        select: { id: true },
    });

    const team = await prisma.team.create({
        data: {
            name: runSeed,
            openRouterKeyEncrypted: encrypt('sk-load-gate-fake-key'),
        },
        select: { id: true },
    });

    await prisma.teamMembership.create({
        data: {
            teamId: team.id,
            userId: user.id,
            role: 'OWNER',
        },
    });

    const project = await prisma.project.create({
        data: {
            name: `${runSeed}-project`,
            teamId: team.id,
            createdByUserId: user.id,
            maxConcurrentRuns: parseBoundedIntEnv({
                name: 'LOAD_GATE_BROWSER_PROJECT_MAX_CONCURRENT_RUNS',
                fallback: runCount,
                min: 1,
                max: 5_000,
            }),
        },
        select: { id: true },
    });

    const testCase = await prisma.testCase.create({
        data: {
            name: `${runSeed}-browser-test-case`,
            projectId: project.id,
            url: targetUrl || 'https://example.com',
            steps: JSON.stringify([
                {
                    id: 'step-1',
                    target: 'main',
                    type: 'playwright-code',
                    action: 'await page.waitForTimeout(10);',
                },
            ]),
            browserConfig: JSON.stringify({
                main: {
                    width: 1280,
                    height: 800,
                    ...(targetUrl ? { url: targetUrl } : {}),
                },
            }),
        },
        select: { id: true },
    });

    await prisma.testRun.createMany({
        data: Array.from({ length: runCount }, () => ({
            testCaseId: testCase.id,
            status: 'QUEUED',
            requiredCapability: BROWSER_EXECUTION_CAPABILITY,
        })),
    });

    const deadlineMs = startedAtMs + timeoutMs;
    let terminalRuns = 0;

    // Start claiming immediately, then keep topping up while runs are active.
    await dispatchQueuedBrowserRuns(dispatchBatchSize);

    while (Date.now() < deadlineMs) {
        const runs = await prisma.testRun.findMany({
            where: { testCaseId: testCase.id },
            select: {
                id: true,
                status: true,
                startedAt: true,
                createdAt: true,
                completedAt: true,
            },
        });

        const nowMs = Date.now();
        const activeLocalRunIds = new Set(getActiveLocalBrowserRunIds());
        const orphanedRunIds = runs
            .filter((run) => (
                run.status === 'PREPARING'
                && !activeLocalRunIds.has(run.id)
                && !!run.startedAt
                && nowMs - run.startedAt.getTime() >= orphanPreparingRequeueAfterMs
            ))
            .map((run) => run.id);

        if (orphanedRunIds.length > 0) {
            await prisma.testRun.updateMany({
                where: {
                    id: { in: orphanedRunIds },
                    status: 'PREPARING',
                },
                data: {
                    status: 'QUEUED',
                    startedAt: null,
                },
            });
            continue;
        }

        terminalRuns = runs.filter((run) => TERMINAL_STATUSES.has(run.status)).length;
        if (terminalRuns >= runCount) {
            break;
        }

        const activeRuns = runs.filter((run) => ACTIVE_STATUSES.has(run.status)).length;
        const queuedRuns = runs.filter((run) => run.status === 'QUEUED').length;

        // Keep claiming queued runs whenever there is remaining work; capacity checks are handled by the dispatcher.
        if (activeRuns > 0 || queuedRuns > 0) {
            await dispatchQueuedBrowserRuns(dispatchBatchSize);
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    const finalRuns = await prisma.testRun.findMany({
        where: { testCaseId: testCase.id },
        select: {
            id: true,
            status: true,
            createdAt: true,
            completedAt: true,
        },
    });

    const completedRuns = finalRuns.filter((run) => TERMINAL_STATUSES.has(run.status) && run.completedAt);
    if (completedRuns.length < runCount) {
        throw new Error(
            `Browser load gate timed out: completed ${completedRuns.length}/${runCount} runs within ${timeoutMs}ms`
        );
    }

    const latenciesMs = completedRuns.map((run) => run.completedAt!.getTime() - run.createdAt.getTime());
    const p95LatencyMs = percentile(latenciesMs, 95);
    const avgLatencyMs = latenciesMs.reduce((sum, value) => sum + value, 0) / latenciesMs.length;
    const failedRuns = completedRuns.filter((run) => run.status !== 'PASS').length;

    const metrics = {
        runCount,
        completedRuns: completedRuns.length,
        failedRuns,
        p95LatencyMs,
        avgLatencyMs,
        minLatencyMs: Math.min(...latenciesMs),
        maxLatencyMs: Math.max(...latenciesMs),
        durationMs: Date.now() - startedAtMs,
        teamId: team.id,
        projectId: project.id,
        testCaseId: testCase.id,
    };

    await ensureParentDirectory(metricsFilePath);
    await writeFile(metricsFilePath, JSON.stringify(metrics, null, 2), 'utf8');
    console.log(JSON.stringify(metrics));
}

void main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
