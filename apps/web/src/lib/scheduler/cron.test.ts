import { describe, expect, it } from 'vitest';
import { computeNextRunAt, compileCron, resolveSchedulePatternFields, SchedulerValidationError, validateCronAndTimezone } from '@/lib/scheduler/cron';
import { SCHEDULE_PATTERN_TYPE } from '@/types';

describe('scheduler cron utilities', () => {
    it('compiles preset schedules into canonical cron expressions', () => {
        expect(compileCron({
            patternType: SCHEDULE_PATTERN_TYPE.DAILY,
            time: '09:15',
        })).toBe('15 9 * * *');

        expect(compileCron({
            patternType: SCHEDULE_PATTERN_TYPE.WEEKLY,
            time: '18:45',
            weekdays: [2],
        })).toBe('45 18 * * 2');

        expect(compileCron({
            patternType: SCHEDULE_PATTERN_TYPE.WEEKLY,
            time: '18:45',
            weekdays: [5, 1, 3, 1],
        })).toBe('45 18 * * 1,3,5');

        expect(compileCron({
            patternType: SCHEDULE_PATTERN_TYPE.MONTHLY,
            time: '06:30',
            daysOfMonth: [28],
        })).toBe('30 6 28 * *');

        expect(compileCron({
            patternType: SCHEDULE_PATTERN_TYPE.MONTHLY,
            time: '06:30',
            daysOfMonth: [15, 1],
        })).toBe('30 6 1,15 * *');
    });

    it('rejects invalid schedule inputs', () => {
        expect(() => compileCron({
            patternType: SCHEDULE_PATTERN_TYPE.DAILY,
            time: '25:00',
        })).toThrow(SchedulerValidationError);

        expect(() => validateCronAndTimezone('* * * * *', 'UTC')).not.toThrow();
        expect(() => validateCronAndTimezone('* * * * * *', 'UTC')).toThrow(SchedulerValidationError);
        expect(() => validateCronAndTimezone('* * * * *', 'Mars/Olympus')).toThrow(SchedulerValidationError);
    });

    it('computes timezone-aware next run dates', () => {
        const nextRunAt = computeNextRunAt('0 9 * * *', 'Asia/Taipei', new Date('2026-06-08T00:30:00.000Z'));
        expect(nextRunAt?.toISOString()).toBe('2026-06-08T01:00:00.000Z');
    });

    it('keeps DST-aware scheduling stable around spring-forward', () => {
        const nextRunAt = computeNextRunAt('0 9 * * *', 'America/New_York', new Date('2026-03-08T04:00:00.000Z'));
        expect(nextRunAt?.toISOString()).toBe('2026-03-08T13:00:00.000Z');
    });

    it('derives editor fields from stored preset schedules', () => {
        expect(resolveSchedulePatternFields(SCHEDULE_PATTERN_TYPE.WEEKLY, '45 18 * * 1,3,5')).toEqual({
            time: '18:45',
            weekdays: [1, 3, 5],
            daysOfMonth: [],
            customCron: null,
        });

        expect(resolveSchedulePatternFields(SCHEDULE_PATTERN_TYPE.MONTHLY, '30 6 1,15 * *')).toEqual({
            time: '06:30',
            weekdays: [],
            daysOfMonth: [1, 15],
            customCron: null,
        });

        expect(resolveSchedulePatternFields(SCHEDULE_PATTERN_TYPE.CUSTOM, '*/5 * * * *')).toEqual({
            time: null,
            weekdays: [],
            daysOfMonth: [],
            customCron: '*/5 * * * *',
        });
    });
});
