export const SCHEDULE_PATTERN_TYPE = {
    DAILY: 'DAILY',
    WEEKLY: 'WEEKLY',
    MONTHLY: 'MONTHLY',
    CUSTOM: 'CUSTOM',
} as const;

export type SchedulePatternType = typeof SCHEDULE_PATTERN_TYPE[keyof typeof SCHEDULE_PATTERN_TYPE];

export interface ScheduleTestCaseSummary {
    id: string;
    displayId: string | null;
    name: string;
    status: string;
    lastRunId: string | null;
    lastRunAt: string | null;
}

export interface ScheduleRecord {
    id: string;
    projectId: string;
    description: string;
    timezone: string;
    patternType: SchedulePatternType;
    cronExpression: string;
    enabled: boolean;
    createdByUserId: string;
    lastRunAt: string | null;
    nextRunAt: string | null;
    lastEnqueuedAt: string | null;
    createdAt: string;
    updatedAt: string;
    time: string | null;
    weekdays: number[];
    daysOfMonth: number[];
    customCron: string | null;
    testCases: ScheduleTestCaseSummary[];
}

export interface ScheduleUpsertInput {
    description: string;
    timezone: string;
    patternType: SchedulePatternType;
    time?: string;
    weekdays?: number[];
    daysOfMonth?: number[];
    customCron?: string;
    enabled?: boolean;
    testCaseIds: string[];
}
