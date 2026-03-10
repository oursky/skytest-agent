import { Prisma } from '@prisma/client';
import { config as appConfig } from '@/config/app';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { startLocalBrowserRun } from '@/lib/runtime/local-browser-runner';
import { BROWSER_EXECUTION_CAPABILITY } from '@/lib/runners/constants';

const logger = createLogger('runtime:browser-run-dispatcher');
const LEGACY_BROWSER_RUNNER_KINDS = ['BROWSER_WORKER', 'CONTROL_PLANE'] as const;
const ACTIVE_RUN_STATUSES = ['PREPARING', 'RUNNING'] as const;

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
            WHERE tr.status = 'QUEUED'
              AND tr."deletedAt" IS NULL
              AND tr."assignedRunnerId" IS NULL
              AND tr."requiredCapability" = ${BROWSER_EXECUTION_CAPABILITY}
              AND (tr."requiredRunnerKind" IS NULL OR tr."requiredRunnerKind" IN (${Prisma.join([...LEGACY_BROWSER_RUNNER_KINDS])}))
              AND (
                  SELECT COUNT(*)
                  FROM "TestRun" activeTr
                  WHERE activeTr."deletedAt" IS NULL
                    AND activeTr.status IN (${Prisma.join(ACTIVE_RUN_STATUSES)})
              ) < ${appConfig.runner.maxConcurrentRuns}
              AND (
                  SELECT COUNT(*)
                  FROM "TestRun" activeTr
                  INNER JOIN "TestCase" activeTc ON activeTc.id = activeTr."testCaseId"
                  WHERE activeTr."deletedAt" IS NULL
                    AND activeTr.status IN (${Prisma.join(ACTIVE_RUN_STATUSES)})
                    AND activeTc."projectId" = tc."projectId"
              ) < p."maxConcurrentRuns"
              AND ${filterSql}
            ORDER BY tr."createdAt" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE "TestRun" tr
        SET
            "status" = 'PREPARING',
            "startedAt" = COALESCE(tr."startedAt", NOW())
        FROM candidate
        WHERE tr.id = candidate.id
        RETURNING tr.id;
    `);

    return rows[0]?.id ?? null;
}

export async function dispatchBrowserRun(runId: string): Promise<boolean> {
    const claimedRunId = await claimBrowserRunWithFilter(Prisma.sql`tr.id = ${runId}`);
    if (!claimedRunId) {
        return false;
    }

    launchLocalBrowserRun(claimedRunId);
    return true;
}

export async function dispatchNextQueuedBrowserRun(): Promise<boolean> {
    const claimedRunId = await claimBrowserRunWithFilter(Prisma.sql`TRUE`);
    if (!claimedRunId) {
        return false;
    }

    launchLocalBrowserRun(claimedRunId);
    return true;
}

export async function dispatchQueuedBrowserRuns(maxDispatches = 1): Promise<number> {
    const safeMaxDispatches = Math.max(1, Math.floor(maxDispatches));
    let dispatched = 0;

    for (let i = 0; i < safeMaxDispatches; i += 1) {
        const claimed = await dispatchNextQueuedBrowserRun();
        if (!claimed) {
            break;
        }
        dispatched += 1;
    }

    return dispatched;
}
