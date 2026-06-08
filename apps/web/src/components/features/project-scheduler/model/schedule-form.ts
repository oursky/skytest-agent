import { computeNextRunAt, compileCron, resolveSchedulePatternFields } from '@/lib/scheduler/cron';
import { SCHEDULE_PATTERN_TYPE, type SchedulePatternType, type ScheduleRecord } from '@/types';

export interface ProjectScheduleFormState {
    description: string;
    timezone: string;
    patternType: SchedulePatternType;
    time: string;
    weekday: number;
    dayOfMonth: number;
    customCron: string;
    enabled: boolean;
    testCaseIds: string[];
}

export interface ProjectScheduleTestCaseOption {
    id: string;
    displayId?: string;
    name: string;
}

export function createDefaultScheduleForm(): ProjectScheduleFormState {
    return {
        description: '',
        timezone: 'UTC',
        patternType: SCHEDULE_PATTERN_TYPE.DAILY,
        time: '09:00',
        weekday: 1,
        dayOfMonth: 1,
        customCron: '',
        enabled: true,
        testCaseIds: [],
    };
}

export function mapScheduleToForm(schedule: ScheduleRecord): ProjectScheduleFormState {
    const fields = resolveSchedulePatternFields(schedule.patternType, schedule.cronExpression);

    return {
        description: schedule.description,
        timezone: schedule.timezone,
        patternType: schedule.patternType,
        time: fields.time ?? schedule.time ?? '09:00',
        weekday: fields.weekday ?? schedule.weekday ?? 1,
        dayOfMonth: fields.dayOfMonth ?? schedule.dayOfMonth ?? 1,
        customCron: fields.customCron ?? schedule.customCron ?? '',
        enabled: schedule.enabled,
        testCaseIds: schedule.testCases.map((testCase) => testCase.id),
    };
}

export function createSchedulePreview(form: ProjectScheduleFormState): {
    cronExpression: string | null;
    nextRunAt: string | null;
    error: string | null;
} {
    try {
        const cronExpression = compileCron({
            patternType: form.patternType,
            time: form.time,
            weekday: form.weekday,
            dayOfMonth: form.dayOfMonth,
            customCron: form.customCron,
        });
        const nextRunAt = form.enabled
            ? computeNextRunAt(cronExpression, form.timezone, new Date())
            : null;

        return {
            cronExpression,
            nextRunAt: nextRunAt?.toISOString() ?? null,
            error: null,
        };
    } catch (error) {
        return {
            cronExpression: null,
            nextRunAt: null,
            error: error instanceof Error ? error.message : 'Invalid schedule',
        };
    }
}

export function humanizeSchedule(schedule: ScheduleRecord): string {
    const timezone = schedule.timezone;
    if (schedule.patternType === SCHEDULE_PATTERN_TYPE.CUSTOM) {
        return `${schedule.cronExpression} (${timezone})`;
    }
    if (schedule.patternType === SCHEDULE_PATTERN_TYPE.DAILY) {
        return `Every day at ${schedule.time ?? '09:00'} (${timezone})`;
    }
    if (schedule.patternType === SCHEDULE_PATTERN_TYPE.WEEKLY) {
        const weekdayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][schedule.weekday ?? 0] ?? 'Sun';
        return `Every ${weekdayLabel} at ${schedule.time ?? '09:00'} (${timezone})`;
    }
    return `Day ${schedule.dayOfMonth ?? 1} each month at ${schedule.time ?? '09:00'} (${timezone})`;
}
