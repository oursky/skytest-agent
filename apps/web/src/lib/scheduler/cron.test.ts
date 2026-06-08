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
            weekday: 2,
        })).toBe('45 18 * * 2');

        expect(compileCron({
            patternType: SCHEDULE_PATTERN_TYPE.MONTHLY,
            time: '06:30',
            dayOfMonth: 28,
        })).toBe('30 6 28 * *');
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
        expect(resolveSchedulePatternFields(SCHEDULE_PATTERN_TYPE.WEEKLY, '45 18 * * 2')).toEqual({
            time: '18:45',
            weekday: 2,
            dayOfMonth: null,
            customCron: null,
        });

        expect(resolveSchedulePatternFields(SCHEDULE_PATTERN_TYPE.CUSTOM, '*/5 * * * *')).toEqual({
            time: null,
            weekday: null,
            dayOfMonth: null,
            customCron: '*/5 * * * *',
        });
    });
});
