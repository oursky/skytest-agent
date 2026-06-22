import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { queueTestCaseRun } from '@/lib/mcp/run-execution';
import { queueRunGroupRun } from '@/lib/run-groups/run-group-service';
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
    runGroups: { runGroupId: string; projectId: string }[];
}

type ClaimOutcome =
    | { kind: 'empty' }
    | { kind: 'skipped' }
    | { kind: 'claimed'; schedule: ClaimedSchedule };

export async function runSchedulerTick(maxDuePerTick: number): Promise<SchedulerTickResult> {
    const now = new Date();
    const claimedSchedules: ClaimedSchedule[] = [];

    for (let index = 0; index < maxDuePerTick; index += 1) {
        const outcome = await prisma.$transaction(async (tx): Promise<ClaimOutcome> => {
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
                return { kind: 'empty' };
            }

            let nextRunAt: Date | null;
            try {
                nextRunAt = computeNextRunAt(row.cronExpression, row.timezone, now);
            } catch (error) {
                await tx.schedule.update({
                    where: { id: row.id },
                    data: { enabled: false, nextRunAt: null },
                });
                logger.error('Disabled schedule with uncomputable next run time', {
                    scheduleId: row.id,
                    cronExpression: row.cronExpression,
                    timezone: row.timezone,
                    error: error instanceof Error ? error.message : String(error),
                });
                return { kind: 'skipped' };
            }

            const linkedTestCases = await tx.scheduleTestCase.findMany({
                where: { scheduleId: row.id },
                select: { testCaseId: true },
            });
            const linkedRunGroups = await tx.scheduleRunGroup.findMany({
                where: { scheduleId: row.id },
                select: { runGroupId: true, runGroup: { select: { projectId: true } } },
            });

            await tx.schedule.update({
                where: { id: row.id },
                data: {
                    lastRunAt: now,
                    lastEnqueuedAt: now,
                    nextRunAt,
                },
            });

            return {
                kind: 'claimed',
                schedule: {
                    id: row.id,
                    createdByUserId: row.createdByUserId,
                    testCaseIds: linkedTestCases.map((entry) => entry.testCaseId),
                    runGroups: linkedRunGroups.map((entry) => ({ runGroupId: entry.runGroupId, projectId: entry.runGroup.projectId })),
                },
            };
        });

        if (outcome.kind === 'empty') {
            break;
        }
        if (outcome.kind === 'skipped') {
            continue;
        }

        claimedSchedules.push(outcome.schedule);
    }

    let enqueuedRuns = 0;
    let failedRuns = 0;

    for (const schedule of claimedSchedules) {
        if (schedule.testCaseIds.length === 0 && schedule.runGroups.length === 0) {
            logger.info('Claimed schedule with no linked test cases or run groups', {
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

        for (const group of schedule.runGroups) {
            const result = await queueRunGroupRun(group.projectId, group.runGroupId, {
                triggerSource: RUN_TRIGGER_SOURCE.SCHEDULER,
            });

            if (result.ok) {
                enqueuedRuns += 1;
                continue;
            }

            failedRuns += 1;
            logger.warn('Failed to enqueue scheduled run group', {
                scheduleId: schedule.id,
                runGroupId: group.runGroupId,
                error: result.error,
            });
        }
    }

    return {
        claimedSchedules: claimedSchedules.length,
        enqueuedRuns,
        failedRuns,
    };
}
