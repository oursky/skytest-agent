import { computeNextRunAt, compileCron, resolveSchedulePatternFields } from '@/lib/scheduler/cron';
import { SCHEDULE_PATTERN_TYPE, type SchedulePatternType, type ScheduleRecord, type ScheduleUpsertInput } from '@/types';

// Cron weekday values (0=Sun) ordered Monday-first for display.
export const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_OF_MONTH_VALUES = Array.from({ length: 28 }, (_, index) => index + 1);

export interface ProjectScheduleFormState {
    description: string;
    timezone: string;
    patternType: SchedulePatternType;
    time: string;
    weekdays: number[];
    daysOfMonth: number[];
    customCron: string;
    enabled: boolean;
    testCaseIds: string[];
    testGroupIds: string[];
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
        weekdays: [1],
        daysOfMonth: [1],
        customCron: '',
        enabled: true,
        testCaseIds: [],
        testGroupIds: [],
    };
}

export function mapScheduleToForm(schedule: ScheduleRecord): ProjectScheduleFormState {
    const fields = resolveSchedulePatternFields(schedule.patternType, schedule.cronExpression);

    return {
        description: schedule.description,
        timezone: schedule.timezone,
        patternType: schedule.patternType,
        time: fields.time ?? schedule.time ?? '09:00',
        weekdays: fields.weekdays.length ? fields.weekdays : [1],
        daysOfMonth: fields.daysOfMonth.length ? fields.daysOfMonth : [1],
        customCron: fields.customCron ?? schedule.customCron ?? '',
        enabled: schedule.enabled,
        testCaseIds: schedule.testCases.map((testCase) => testCase.id),
        testGroupIds: schedule.testGroups.map((testGroup) => testGroup.id),
    };
}

export function formatTimezoneLabel(timezone: string): string {
    if (timezone === 'UTC') {
        return 'UTC';
    }
    // POSIX Etc/GMT zones invert the sign: Etc/GMT-8 is UTC+8.
    const match = /^Etc\/GMT([+-])(\d{1,2})$/.exec(timezone);
    if (match) {
        return `UTC${match[1] === '-' ? '+' : '-'}${match[2]}`;
    }
    return timezone;
}

export function scheduleToUpsertInput(schedule: ScheduleRecord): ScheduleUpsertInput {
    return {
        description: schedule.description,
        timezone: schedule.timezone,
        patternType: schedule.patternType,
        time: schedule.time ?? undefined,
        weekdays: schedule.weekdays.length ? schedule.weekdays : undefined,
        daysOfMonth: schedule.daysOfMonth.length ? schedule.daysOfMonth : undefined,
        customCron: schedule.customCron ?? undefined,
        enabled: schedule.enabled,
        testCaseIds: schedule.testCases.map((testCase) => testCase.id),
        testGroupIds: schedule.testGroups.map((testGroup) => testGroup.id),
    };
}

export function createSchedulePreview(form: ProjectScheduleFormState): {
    cronExpression: string | null;
    nextRunAt: string | null;
    error: string | null;
} {
    if (form.patternType === SCHEDULE_PATTERN_TYPE.CUSTOM && !form.customCron.trim()) {
        return { cronExpression: null, nextRunAt: null, error: null };
    }

    try {
        const cronExpression = compileCron({
            patternType: form.patternType,
            time: form.time,
            weekdays: form.weekdays,
            daysOfMonth: form.daysOfMonth,
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

export function humanizeSchedule(
    schedule: ScheduleRecord,
    t: (key: string, values?: Record<string, string | number>) => string
): string {
    const timezone = formatTimezoneLabel(schedule.timezone);
    const time = schedule.time ?? '09:00';
    if (schedule.patternType === SCHEDULE_PATTERN_TYPE.CUSTOM) {
        return t('project.scheduler.cadence.custom', { cron: schedule.cronExpression, timezone });
    }
    if (schedule.patternType === SCHEDULE_PATTERN_TYPE.DAILY) {
        return t('project.scheduler.cadence.daily', { time, timezone });
    }
    if (schedule.patternType === SCHEDULE_PATTERN_TYPE.WEEKLY) {
        const weekdayLabels = [
            t('project.scheduler.weekday.0'),
            t('project.scheduler.weekday.1'),
            t('project.scheduler.weekday.2'),
            t('project.scheduler.weekday.3'),
            t('project.scheduler.weekday.4'),
            t('project.scheduler.weekday.5'),
            t('project.scheduler.weekday.6'),
        ];
        const weekday = WEEKDAY_DISPLAY_ORDER
            .filter((value) => schedule.weekdays.includes(value))
            .map((value) => weekdayLabels[value])
            .join(', ');
        return t('project.scheduler.cadence.weekly', { weekday, time, timezone });
    }
    const days = [...schedule.daysOfMonth].sort((left, right) => left - right).join(', ');
    return t('project.scheduler.cadence.monthly', { day: days, time, timezone });
}
