import { computeNextRunAt, compileCron, resolveSchedulePatternFields } from '@/lib/scheduler/cron';
import { SCHEDULE_PATTERN_TYPE, type SchedulePatternType, type ScheduleRecord, type ScheduleUpsertInput } from '@/types';

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
        weekday: schedule.weekday ?? undefined,
        dayOfMonth: schedule.dayOfMonth ?? undefined,
        customCron: schedule.customCron ?? undefined,
        enabled: schedule.enabled,
        testCaseIds: schedule.testCases.map((testCase) => testCase.id),
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
        const weekday = schedule.weekday ?? 0;
        const normalizedWeekday = weekday >= 0 && weekday <= 6 ? weekday : 0;
        return t('project.scheduler.cadence.weekly', {
            weekday: weekdayLabels[normalizedWeekday],
            time,
            timezone,
        });
    }
    return t('project.scheduler.cadence.monthly', { day: schedule.dayOfMonth ?? 1, time, timezone });
}
