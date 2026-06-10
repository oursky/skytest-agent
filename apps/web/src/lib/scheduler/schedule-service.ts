import { prisma } from '@/lib/core/prisma';
import { computeNextRunAt, compileCron, resolveSchedulePatternFields, validateCronAndTimezone, SchedulerValidationError } from '@/lib/scheduler/cron';
import { type ScheduleRecord, type ScheduleUpsertInput } from '@/types';

const MAX_DESCRIPTION_LENGTH = 500;

export async function listProjectSchedules(projectId: string): Promise<ScheduleRecord[]> {
    const schedules = await prisma.schedule.findMany({
        where: { projectId },
        orderBy: [
            { createdAt: 'asc' },
            { id: 'asc' },
        ],
        include: {
            testCases: {
                orderBy: {
                    testCase: {
                        name: 'asc',
                    },
                },
                select: {
                    testCase: {
                        select: {
                            id: true,
                            displayId: true,
                            name: true,
                            status: true,
                        },
                    },
                },
            },
        },
    });

    const latestRuns = await buildLatestRunMap(
        schedules.flatMap((schedule) => schedule.testCases.map(({ testCase }) => testCase.id))
    );
    return schedules.map((schedule) => serializeScheduleRecord(schedule, latestRuns));
}

export async function getProjectSchedule(projectId: string, scheduleId: string): Promise<ScheduleRecord | null> {
    const schedule = await prisma.schedule.findFirst({
        where: {
            id: scheduleId,
            projectId,
        },
        include: {
            testCases: {
                orderBy: {
                    testCase: {
                        name: 'asc',
                    },
                },
                select: {
                    testCase: {
                        select: {
                            id: true,
                            displayId: true,
                            name: true,
                            status: true,
                        },
                    },
                },
            },
        },
    });

    if (!schedule) {
        return null;
    }

    const latestRuns = await buildLatestRunMap(schedule.testCases.map(({ testCase }) => testCase.id));
    return serializeScheduleRecord(schedule, latestRuns);
}

export async function createProjectSchedule(input: {
    projectId: string;
    userId: string;
    body: ScheduleUpsertInput;
}): Promise<ScheduleRecord> {
    const prepared = await prepareScheduleMutation({
        projectId: input.projectId,
        body: input.body,
    });

    const schedule = await prisma.schedule.create({
        data: {
            projectId: input.projectId,
            description: prepared.description,
            timezone: prepared.timezone,
            patternType: prepared.patternType,
            cronExpression: prepared.cronExpression,
            enabled: prepared.enabled,
            createdByUserId: input.userId,
            nextRunAt: prepared.nextRunAt,
            testCases: {
                create: prepared.testCaseIds.map((testCaseId) => ({ testCaseId })),
            },
        },
        include: {
            testCases: {
                orderBy: {
                    testCase: {
                        name: 'asc',
                    },
                },
                select: {
                    testCase: {
                        select: {
                            id: true,
                            displayId: true,
                            name: true,
                            status: true,
                        },
                    },
                },
            },
        },
    });

    const latestRuns = await buildLatestRunMap(schedule.testCases.map(({ testCase }) => testCase.id));
    return serializeScheduleRecord(schedule, latestRuns);
}

export async function updateProjectSchedule(input: {
    projectId: string;
    scheduleId: string;
    body: ScheduleUpsertInput;
}): Promise<ScheduleRecord | null> {
    const existing = await prisma.schedule.findFirst({
        where: {
            id: input.scheduleId,
            projectId: input.projectId,
        },
        select: {
            id: true,
            createdByUserId: true,
        },
    });
    if (!existing) {
        return null;
    }

    const prepared = await prepareScheduleMutation({
        projectId: input.projectId,
        body: input.body,
    });

    const schedule = await prisma.$transaction(async (tx) => {
        await tx.scheduleTestCase.deleteMany({
            where: { scheduleId: input.scheduleId },
        });

        return tx.schedule.update({
            where: { id: input.scheduleId },
            data: {
                description: prepared.description,
                timezone: prepared.timezone,
                patternType: prepared.patternType,
                cronExpression: prepared.cronExpression,
                enabled: prepared.enabled,
                nextRunAt: prepared.nextRunAt,
                testCases: {
                    create: prepared.testCaseIds.map((testCaseId) => ({ testCaseId })),
                },
            },
            include: {
                testCases: {
                    orderBy: {
                        testCase: {
                            name: 'asc',
                        },
                    },
                    select: {
                        testCase: {
                            select: {
                                id: true,
                                displayId: true,
                                name: true,
                                status: true,
                            },
                        },
                    },
                },
            },
        });
    });

    const latestRuns = await buildLatestRunMap(schedule.testCases.map(({ testCase }) => testCase.id));
    return serializeScheduleRecord(schedule, latestRuns);
}

export async function deleteProjectSchedule(projectId: string, scheduleId: string): Promise<boolean> {
    const deleted = await prisma.schedule.deleteMany({
        where: {
            id: scheduleId,
            projectId,
        },
    });
    return deleted.count === 1;
}

export function isSchedulerValidationError(error: unknown): error is SchedulerValidationError {
    return error instanceof SchedulerValidationError;
}

async function prepareScheduleMutation(input: {
    projectId: string;
    body: ScheduleUpsertInput;
}): Promise<{
    description: string;
    timezone: string;
    patternType: ScheduleUpsertInput['patternType'];
    cronExpression: string;
    enabled: boolean;
    nextRunAt: Date | null;
    testCaseIds: string[];
}> {
    const description = input.body.description.trim();
    if (!description) {
        throw new SchedulerValidationError('Description is required');
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
        throw new SchedulerValidationError(`Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
    }

    const testCaseIds = [...new Set(
        input.body.testCaseIds
            .filter((testCaseId): testCaseId is string => typeof testCaseId === 'string')
            .map((testCaseId) => testCaseId.trim())
            .filter(Boolean)
    )];
    if (testCaseIds.length === 0) {
        throw new SchedulerValidationError('At least one test case is required');
    }

    const cronExpression = compileCron({
        patternType: input.body.patternType,
        time: input.body.time,
        weekdays: input.body.weekdays,
        daysOfMonth: input.body.daysOfMonth,
        customCron: input.body.customCron,
    });
    const timezone = input.body.timezone.trim();
    const enabled = input.body.enabled ?? true;
    validateCronAndTimezone(cronExpression, timezone);
    const nextRunAt = enabled ? computeNextRunAt(cronExpression, timezone, new Date()) : null;
    if (enabled && !nextRunAt) {
        throw new SchedulerValidationError('Schedule does not have a future run time');
    }

    const matchingTestCases = await prisma.testCase.findMany({
        where: {
            projectId: input.projectId,
            id: { in: testCaseIds },
        },
        select: { id: true },
    });
    if (matchingTestCases.length !== testCaseIds.length) {
        throw new SchedulerValidationError('One or more selected test cases do not belong to this project');
    }

    return {
        description,
        timezone,
        patternType: input.body.patternType,
        cronExpression,
        enabled,
        nextRunAt,
        testCaseIds,
    };
}

interface LatestRunSummary {
    id: string;
    status: string;
    at: Date;
}

async function buildLatestRunMap(testCaseIds: string[]): Promise<Map<string, LatestRunSummary>> {
    const uniqueIds = [...new Set(testCaseIds)];
    if (uniqueIds.length === 0) {
        return new Map();
    }

    const runs = await prisma.testRun.findMany({
        where: {
            testCaseId: { in: uniqueIds },
            deletedAt: null,
        },
        orderBy: [
            { testCaseId: 'asc' },
            { createdAt: 'desc' },
        ],
        distinct: ['testCaseId'],
        select: {
            id: true,
            testCaseId: true,
            status: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
        },
    });

    return new Map(runs.map((run) => [
        run.testCaseId,
        {
            id: run.id,
            status: run.status,
            at: run.completedAt ?? run.startedAt ?? run.createdAt,
        },
    ]));
}

function serializeScheduleRecord(schedule: {
    id: string;
    projectId: string;
    description: string;
    timezone: string;
    patternType: ScheduleRecord['patternType'];
    cronExpression: string;
    enabled: boolean;
    createdByUserId: string;
    lastRunAt: Date | null;
    nextRunAt: Date | null;
    lastEnqueuedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    testCases: Array<{
        testCase: {
            id: string;
            displayId: string | null;
            name: string;
            status: string;
        };
    }>;
}, latestRuns: Map<string, LatestRunSummary>): ScheduleRecord {
    const fields = resolveSchedulePatternFields(schedule.patternType, schedule.cronExpression);

    return {
        id: schedule.id,
        projectId: schedule.projectId,
        description: schedule.description,
        timezone: schedule.timezone,
        patternType: schedule.patternType,
        cronExpression: schedule.cronExpression,
        enabled: schedule.enabled,
        createdByUserId: schedule.createdByUserId,
        lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
        nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
        lastEnqueuedAt: schedule.lastEnqueuedAt?.toISOString() ?? null,
        createdAt: schedule.createdAt.toISOString(),
        updatedAt: schedule.updatedAt.toISOString(),
        time: fields.time,
        weekdays: fields.weekdays,
        daysOfMonth: fields.daysOfMonth,
        customCron: fields.customCron,
        testCases: schedule.testCases.map(({ testCase }) => {
            const latestRun = latestRuns.get(testCase.id);
            return {
                id: testCase.id,
                displayId: testCase.displayId,
                name: testCase.name,
                status: testCase.status,
                lastRunId: latestRun?.id ?? null,
                lastRunAt: latestRun?.at.toISOString() ?? null,
            };
        }),
    };
}
