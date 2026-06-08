import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { queueTestCaseRun } from '@/lib/mcp/run-execution';
import { computeNextRunAt } from '@/lib/scheduler/cron';
import { RUN_TRIGGER_SOURCE } from '@/types';

const logger = createLogger('scheduler:tick');

interface DueScheduleRow {
    id: string;
    cronExpression: string;
    timezone: string;
    createdByUserId: string;
}

export interface SchedulerTickResult {
    claimedSchedules: number;
    enqueuedRuns: number;
    failedRuns: number;
}

interface ClaimedSchedule {
    id: string;
    createdByUserId: string;
    testCaseIds: string[];
}

export async function runSchedulerTick(maxDuePerTick: number): Promise<SchedulerTickResult> {
    const now = new Date();
    const claimedSchedules: ClaimedSchedule[] = [];

    for (let index = 0; index < maxDuePerTick; index += 1) {
        const claimedSchedule = await prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<DueScheduleRow[]>(Prisma.sql`
                SELECT
                    s.id,
                    s."cronExpression",
                    s.timezone,
                    s."createdByUserId"
                FROM "Schedule" s
                WHERE s.enabled = true
                  AND s."nextRunAt" IS NOT NULL
                  AND s."nextRunAt" <= ${now}
                ORDER BY s."nextRunAt" ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            `);

            const row = rows[0];
            if (!row) {
                return null;
            }

            const linkedTestCases = await tx.scheduleTestCase.findMany({
                where: { scheduleId: row.id },
                select: { testCaseId: true },
            });
            const nextRunAt = computeNextRunAt(row.cronExpression, row.timezone, now);

            await tx.schedule.update({
                where: { id: row.id },
                data: {
                    lastRunAt: now,
                    lastEnqueuedAt: now,
                    nextRunAt,
                },
            });

            return {
                id: row.id,
                createdByUserId: row.createdByUserId,
                testCaseIds: linkedTestCases.map((entry) => entry.testCaseId),
            } satisfies ClaimedSchedule;
        });

        if (!claimedSchedule) {
            break;
        }

        claimedSchedules.push(claimedSchedule);
    }

    let enqueuedRuns = 0;
    let failedRuns = 0;

    for (const schedule of claimedSchedules) {
        if (schedule.testCaseIds.length === 0) {
            logger.info('Claimed schedule with no linked test cases', {
                scheduleId: schedule.id,
            });
            continue;
        }

        for (const testCaseId of schedule.testCaseIds) {
            const result = await queueTestCaseRun(
                schedule.createdByUserId,
                testCaseId,
                undefined,
                { source: RUN_TRIGGER_SOURCE.SCHEDULER }
            );

            if (result.ok) {
                enqueuedRuns += 1;
                continue;
            }

            failedRuns += 1;
            logger.warn('Failed to enqueue scheduled test case run', {
                scheduleId: schedule.id,
                testCaseId,
                error: result.failure.error,
                details: result.failure.details,
            });
        }
    }

    return {
        claimedSchedules: claimedSchedules.length,
        enqueuedRuns,
        failedRuns,
    };
}
