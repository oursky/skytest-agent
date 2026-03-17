import { Prisma } from '@prisma/client';
import { config as appConfig } from '@/config/app';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import {
    hasLocalBrowserRunCapacity,
    getActiveLocalBrowserRunCount,
    getMaxLocalBrowserRunCount,
    startLocalBrowserRun,
} from '@/lib/runtime/local-browser-runner';
import { BROWSER_EXECUTION_CAPABILITY } from '@/lib/runners/constants';
import { RUN_IN_PROGRESS_STATUSES, TEST_STATUS } from '@/types';

const logger = createLogger('runtime:browser-run-dispatcher');
let dispatchLock: Promise<unknown> = Promise.resolve();
let browserWorkerDisabledLogged = false;

function ensureBrowserWorkerEnabled(): boolean {
    if (appConfig.browserWorker.enabled) {
        return true;
    }

    if (!browserWorkerDisabledLogged) {
        browserWorkerDisabledLogged = true;
        logger.info('Skipping browser run dispatch because browser worker mode is disabled');
    }

    return false;
}

async function withDispatchLock<T>(handler: () => Promise<T>): Promise<T> {
    const run = dispatchLock.then(handler, handler);
    // Keep the queue moving even if a previous dispatch failed; callers still observe `run` errors.
    dispatchLock = run.catch(() => undefined);
    return run;
}

function launchLocalBrowserRun(runId: string): void {
    void startLocalBrowserRun(runId).catch((error) => {
        logger.error('Failed to execute dispatched browser run', {
            runId,
            error: error instanceof Error ? error.message : String(error),
        });
    });
}

async function claimBrowserRunWithFilter(filterSql: Prisma.Sql): Promise<string | null> {
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        WITH candidate AS (
            SELECT tr.id
            FROM "TestRun" tr
            INNER JOIN "TestCase" tc ON tc.id = tr."testCaseId"
            INNER JOIN "Project" p ON p.id = tc."projectId"
            WHERE tr.status = ${TEST_STATUS.QUEUED}
              AND tr."deletedAt" IS NULL
              AND tr."assignedRunnerId" IS NULL
              AND tr."requiredCapability" = ${BROWSER_EXECUTION_CAPABILITY}
              AND tr."requiredRunnerKind" IS NULL
              AND (
                  SELECT COUNT(*)
                  FROM "TestRun" activeTr
                  WHERE activeTr."deletedAt" IS NULL
                    AND activeTr.status IN (${Prisma.join(RUN_IN_PROGRESS_STATUSES)})
              ) < ${appConfig.runner.maxConcurrentRuns}
              AND (
                  SELECT COUNT(*)
                  FROM "TestRun" activeTr
                  INNER JOIN "TestCase" activeTc ON activeTc.id = activeTr."testCaseId"
                  WHERE activeTr."deletedAt" IS NULL
                    AND activeTr.status IN (${Prisma.join(RUN_IN_PROGRESS_STATUSES)})
                    AND activeTc."projectId" = tc."projectId"
              ) < p."maxConcurrentRuns"
              AND ${filterSql}
            ORDER BY tr."createdAt" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE "TestRun" tr
        SET
            "status" = ${TEST_STATUS.PREPARING},
            "startedAt" = COALESCE(tr."startedAt", NOW())
        FROM candidate
        WHERE tr.id = candidate.id
        RETURNING tr.id;
    `);

    return rows[0]?.id ?? null;
}

export async function dispatchBrowserRun(runId: string): Promise<boolean> {
    return withDispatchLock(async () => {
        if (!ensureBrowserWorkerEnabled()) {
            return false;
        }

        if (!hasLocalBrowserRunCapacity()) {
            return false;
        }

        const claimedRunId = await claimBrowserRunWithFilter(Prisma.sql`tr.id = ${runId}`);
        if (!claimedRunId) {
            return false;
        }

        launchLocalBrowserRun(claimedRunId);
        return true;
    });
}

export async function dispatchNextQueuedBrowserRun(): Promise<boolean> {
    return withDispatchLock(async () => {
        if (!ensureBrowserWorkerEnabled()) {
            return false;
        }

        if (!hasLocalBrowserRunCapacity()) {
            return false;
        }

        const claimedRunId = await claimBrowserRunWithFilter(Prisma.sql`TRUE`);
        if (!claimedRunId) {
            return false;
        }

        launchLocalBrowserRun(claimedRunId);
        return true;
    });
}

export async function dispatchQueuedBrowserRuns(maxDispatches = 1): Promise<number> {
    return withDispatchLock(async () => {
        if (!ensureBrowserWorkerEnabled()) {
            return 0;
        }

        const safeMaxDispatches = Math.max(1, Math.floor(maxDispatches));
        const availableLocalSlots = Math.max(0, getMaxLocalBrowserRunCount() - getActiveLocalBrowserRunCount());
        const dispatchLimit = Math.min(safeMaxDispatches, availableLocalSlots);
        let dispatched = 0;

        for (let i = 0; i < dispatchLimit; i += 1) {
            const claimedRunId = await claimBrowserRunWithFilter(Prisma.sql`TRUE`);
            if (!claimedRunId) {
                break;
            }

            launchLocalBrowserRun(claimedRunId);
            dispatched += 1;
        }

        return dispatched;
    });
}
