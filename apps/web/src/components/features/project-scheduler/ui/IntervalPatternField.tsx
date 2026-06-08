'use client';

import { CustomSelect } from '@/components/shared';
import { SCHEDULE_PATTERN_TYPE, type SchedulePatternType } from '@/types';

interface IntervalPatternFieldProps {
    patternType: SchedulePatternType;
    time: string;
    weekday: number;
    dayOfMonth: number;
    customCron: string;
    disabled?: boolean;
    cronPreview: string | null;
    nextRunPreview: string | null;
    previewError: string | null;
    t: (key: string, values?: Record<string, string | number>) => string;
    onPatternTypeChange: (value: SchedulePatternType) => void;
    onTimeChange: (value: string) => void;
    onWeekdayChange: (value: number) => void;
    onDayOfMonthChange: (value: number) => void;
    onCustomCronChange: (value: string) => void;
}

const weekdayOptions = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
];

const dayOfMonthOptions = Array.from({ length: 28 }, (_, index) => ({
    value: index + 1,
    label: String(index + 1),
}));

const patternOptions: Array<{ value: SchedulePatternType; labelKey: string }> = [
    { value: SCHEDULE_PATTERN_TYPE.DAILY, labelKey: 'project.scheduler.pattern.daily' },
    { value: SCHEDULE_PATTERN_TYPE.WEEKLY, labelKey: 'project.scheduler.pattern.weekly' },
    { value: SCHEDULE_PATTERN_TYPE.MONTHLY, labelKey: 'project.scheduler.pattern.monthly' },
    { value: SCHEDULE_PATTERN_TYPE.CUSTOM, labelKey: 'project.scheduler.pattern.custom' },
];

export default function IntervalPatternField({
    patternType,
    time,
    weekday,
    dayOfMonth,
    customCron,
    disabled = false,
    cronPreview,
    nextRunPreview,
    previewError,
    t,
    onPatternTypeChange,
    onTimeChange,
    onWeekdayChange,
    onDayOfMonthChange,
    onCustomCronChange,
}: IntervalPatternFieldProps) {
    return (
        <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
                {patternOptions.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
                        <input
                            type="radio"
                            name="schedule-pattern"
                            checked={patternType === option.value}
                            onChange={() => onPatternTypeChange(option.value)}
                            disabled={disabled}
                            className="h-4 w-4"
                        />
                        <span>{t(option.labelKey)}</span>
                    </label>
                ))}
            </div>

            {patternType !== SCHEDULE_PATTERN_TYPE.CUSTOM && (
                <div className="grid gap-3 md:grid-cols-3">
                    <input
                        type="time"
                        value={time}
                        onChange={(event) => onTimeChange(event.target.value)}
                        disabled={disabled}
                        className="h-10 rounded-md border border-gray-300 px-3 text-sm"
                    />
                    {patternType === SCHEDULE_PATTERN_TYPE.WEEKLY && (
                        <CustomSelect
                            value={weekday}
                            options={weekdayOptions}
                            onChange={onWeekdayChange}
                            disabled={disabled}
                            fullWidth
                            buttonClassName="h-10 rounded-md border border-gray-300 px-3 text-left text-sm"
                        />
                    )}
                    {patternType === SCHEDULE_PATTERN_TYPE.MONTHLY && (
                        <CustomSelect
                            value={dayOfMonth}
                            options={dayOfMonthOptions}
                            onChange={onDayOfMonthChange}
                            disabled={disabled}
                            fullWidth
                            buttonClassName="h-10 rounded-md border border-gray-300 px-3 text-left text-sm"
                        />
                    )}
                </div>
            )}

            {patternType === SCHEDULE_PATTERN_TYPE.CUSTOM && (
                <div className="space-y-2">
                    <input
                        type="text"
                        value={customCron}
                        onChange={(event) => onCustomCronChange(event.target.value)}
                        disabled={disabled}
                        placeholder="0 9 * * *"
                        className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
                    />
                    <a
                        href="https://en.wikipedia.org/wiki/Cron"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                    >
                        {t('project.scheduler.cronHelp')}
                    </a>
                </div>
            )}

            <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <p>{t('project.scheduler.preview.cron', { cron: cronPreview ?? '-' })}</p>
                <p>{t('project.scheduler.preview.nextRun', { value: nextRunPreview ?? '-' })}</p>
                {previewError && <p className="mt-1 text-red-600">{previewError}</p>}
            </div>
        </div>
    );
}
