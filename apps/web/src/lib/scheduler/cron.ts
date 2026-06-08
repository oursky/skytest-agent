import { CronExpressionParser } from 'cron-parser';
import { SCHEDULE_PATTERN_TYPE, type SchedulePatternType } from '@/types';

const TIME_VALUE_RE = /^(\d{2}):(\d{2})$/;

export class SchedulerValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SchedulerValidationError';
    }
}

export interface SchedulePatternFields {
    time: string | null;
    weekdays: number[];
    daysOfMonth: number[];
    customCron: string | null;
}

export function compileCron(input: {
    patternType: SchedulePatternType;
    time?: string;
    weekdays?: number[];
    daysOfMonth?: number[];
    customCron?: string;
}): string {
    switch (input.patternType) {
        case SCHEDULE_PATTERN_TYPE.DAILY: {
            const { hour, minute } = parseTime(input.time);
            return `${minute} ${hour} * * *`;
        }
        case SCHEDULE_PATTERN_TYPE.WEEKLY: {
            const { hour, minute } = parseTime(input.time);
            const weekdays = parseIntList(input.weekdays, 0, 6, 'Select at least one weekday');
            return `${minute} ${hour} * * ${weekdays.join(',')}`;
        }
        case SCHEDULE_PATTERN_TYPE.MONTHLY: {
            const { hour, minute } = parseTime(input.time);
            const daysOfMonth = parseIntList(input.daysOfMonth, 1, 28, 'Select at least one day of month');
            return `${minute} ${hour} ${daysOfMonth.join(',')} * *`;
        }
        case SCHEDULE_PATTERN_TYPE.CUSTOM: {
            const customCron = typeof input.customCron === 'string' ? input.customCron.trim() : '';
            if (!customCron) {
                throw new SchedulerValidationError('Custom cron expression is required');
            }
            return customCron;
        }
        default:
            throw new SchedulerValidationError('Unsupported schedule pattern');
    }
}

export function validateCronAndTimezone(cron: string, timezone: string): void {
    validateTimezone(timezone);
    try {
        CronExpressionParser.parse(toCronParserExpression(cron), {
            currentDate: new Date(),
            tz: timezone,
            strict: true,
        });
    } catch (error) {
        throw new SchedulerValidationError(
            error instanceof Error ? error.message : 'Invalid cron expression'
        );
    }
}

export function computeNextRunAt(cron: string, timezone: string, after: Date): Date | null {
    validateCronAndTimezone(cron, timezone);

    try {
        const interval = CronExpressionParser.parse(toCronParserExpression(cron), {
            currentDate: after,
            tz: timezone,
            strict: true,
        });
        return interval.next().toDate();
    } catch (error) {
        if (error instanceof Error && /out of range|cannot find next/i.test(error.message)) {
            return null;
        }
        throw error;
    }
}

export function resolveSchedulePatternFields(
    patternType: SchedulePatternType,
    cronExpression: string
): SchedulePatternFields {
    if (patternType === SCHEDULE_PATTERN_TYPE.CUSTOM) {
        return {
            time: null,
            weekdays: [],
            daysOfMonth: [],
            customCron: cronExpression,
        };
    }

    const [minuteField, hourField, dayOfMonthField, monthField, weekdayField] = cronExpression.trim().split(/\s+/);
    const hour = Number.parseInt(hourField ?? '', 10);
    const minute = Number.parseInt(minuteField ?? '', 10);
    const time = Number.isInteger(hour) && Number.isInteger(minute)
        ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
        : null;

    if (patternType === SCHEDULE_PATTERN_TYPE.DAILY) {
        return { time, weekdays: [], daysOfMonth: [], customCron: null };
    }

    if (patternType === SCHEDULE_PATTERN_TYPE.WEEKLY) {
        return {
            time,
            weekdays: parseCronIntList(weekdayField, 0, 6),
            daysOfMonth: [],
            customCron: null,
        };
    }

    return {
        time,
        weekdays: [],
        daysOfMonth: monthField === '*' ? parseCronIntList(dayOfMonthField, 1, 28) : [],
        customCron: null,
    };
}

function validateTimezone(timezone: string): void {
    const value = timezone.trim();
    if (!value) {
        throw new SchedulerValidationError('Timezone is required');
    }

    try {
        Intl.DateTimeFormat(undefined, { timeZone: value }).format(new Date());
    } catch {
        throw new SchedulerValidationError('Invalid timezone');
    }
}

function parseTime(value: string | undefined): { hour: number; minute: number } {
    const match = TIME_VALUE_RE.exec(value ?? '');
    if (!match) {
        throw new SchedulerValidationError('Time must be in HH:mm format');
    }

    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        throw new SchedulerValidationError('Time must be in HH:mm format');
    }

    return { hour, minute };
}

function parseIntList(values: number[] | undefined, min: number, max: number, message: string): number[] {
    if (!Array.isArray(values) || values.length === 0) {
        throw new SchedulerValidationError(message);
    }
    const unique = new Set<number>();
    for (const value of values) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
            throw new SchedulerValidationError(message);
        }
        unique.add(value);
    }
    return [...unique].sort((left, right) => left - right);
}

function parseCronIntList(field: string | undefined, min: number, max: number): number[] {
    if (!field) {
        return [];
    }
    const values = field.split(',')
        .map((part) => Number.parseInt(part, 10))
        .filter((value) => Number.isInteger(value) && value >= min && value <= max);
    return [...new Set(values)].sort((left, right) => left - right);
}

function toCronParserExpression(cron: string): string {
    const fields = cron.trim().split(/\s+/);
    if (fields.length !== 5) {
        throw new SchedulerValidationError('Cron expression must have exactly 5 fields');
    }
    return `0 ${fields.join(' ')}`;
}
