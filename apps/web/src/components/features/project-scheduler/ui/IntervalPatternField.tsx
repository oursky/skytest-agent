'use client';

import { CustomSelect } from '@/components/shared';
import { SCHEDULE_PATTERN_TYPE, type SchedulePatternType } from '@/types';
import { DAY_OF_MONTH_VALUES, WEEKDAY_DISPLAY_ORDER } from '../model/schedule-form';
import MultiSelectMenu from './MultiSelectMenu';

interface IntervalPatternFieldProps {
    patternType: SchedulePatternType;
    time: string;
    weekdays: number[];
    daysOfMonth: number[];
    customCron: string;
    disabled?: boolean;
    cronPreview: string | null;
    nextRunPreview: string | null;
    previewError: string | null;
    t: (key: string, values?: Record<string, string | number>) => string;
    onPatternTypeChange: (value: SchedulePatternType) => void;
    onTimeChange: (value: string) => void;
    onWeekdaysChange: (value: number[]) => void;
    onDaysOfMonthChange: (value: number[]) => void;
    onCustomCronChange: (value: string) => void;
}

const patternOptions: Array<{ value: SchedulePatternType; labelKey: string }> = [
    { value: SCHEDULE_PATTERN_TYPE.DAILY, labelKey: 'project.scheduler.pattern.daily' },
    { value: SCHEDULE_PATTERN_TYPE.WEEKLY, labelKey: 'project.scheduler.pattern.weekly' },
    { value: SCHEDULE_PATTERN_TYPE.MONTHLY, labelKey: 'project.scheduler.pattern.monthly' },
    { value: SCHEDULE_PATTERN_TYPE.CUSTOM, labelKey: 'project.scheduler.pattern.custom' },
];

export default function IntervalPatternField({
    patternType,
    time,
    weekdays,
    daysOfMonth,
    customCron,
    disabled = false,
    cronPreview,
    nextRunPreview,
    previewError,
    t,
    onPatternTypeChange,
    onTimeChange,
    onWeekdaysChange,
    onDaysOfMonthChange,
    onCustomCronChange,
}: IntervalPatternFieldProps) {
    const patternSelectOptions = patternOptions.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
    }));

    const weekdaySet = new Set(weekdays);
    const dayOfMonthOptions = DAY_OF_MONTH_VALUES.map((value) => ({ value, label: String(value) }));

    const toggleWeekday = (value: number) => {
        onWeekdaysChange(weekdaySet.has(value)
            ? weekdays.filter((item) => item !== value)
            : [...weekdays, value]);
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <div className="w-48">
                    <CustomSelect
                        value={patternType}
                        options={patternSelectOptions}
                        onChange={onPatternTypeChange}
                        disabled={disabled}
                        fullWidth
                        buttonClassName="h-10 w-full rounded-md border border-gray-300 px-3 text-left text-sm"
                    />
                </div>

                {patternType === SCHEDULE_PATTERN_TYPE.WEEKLY && (
                    <div className="flex flex-wrap gap-1">
                        {WEEKDAY_DISPLAY_ORDER.map((value) => (
                            <button
                                key={value}
                                type="button"
                                disabled={disabled}
                                onClick={() => toggleWeekday(value)}
                                className={`h-10 w-12 rounded-md border text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${weekdaySet.has(value) ? 'border-primary bg-primary text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                            >
                                {t(`project.scheduler.weekday.${value}`)}
                            </button>
                        ))}
                    </div>
                )}

                {patternType === SCHEDULE_PATTERN_TYPE.MONTHLY && (
                    <div className="w-48">
                        <MultiSelectMenu
                            options={dayOfMonthOptions}
                            selected={daysOfMonth}
                            disabled={disabled}
                            placeholder={t('project.scheduler.fields.selectDays')}
                            onChange={onDaysOfMonthChange}
                        />
                    </div>
                )}

                {patternType === SCHEDULE_PATTERN_TYPE.CUSTOM ? (
                    <input
                        type="text"
                        value={customCron}
                        onChange={(event) => onCustomCronChange(event.target.value)}
                        disabled={disabled}
                        placeholder="0 9 * * *"
                        className="h-10 w-full max-w-xs rounded-md border border-gray-300 px-3 text-sm"
                    />
                ) : (
                    <input
                        type="time"
                        value={time}
                        onChange={(event) => onTimeChange(event.target.value)}
                        disabled={disabled}
                        className="h-10 w-32 rounded-md border border-gray-300 px-3 text-sm"
                    />
                )}
            </div>

            {patternType === SCHEDULE_PATTERN_TYPE.CUSTOM && (
                <a
                    href="https://en.wikipedia.org/wiki/Cron"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-primary hover:underline"
                >
                    {t('project.scheduler.cronHelp')}
                </a>
            )}

            <div className="w-fit max-w-md rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <p>{t('project.scheduler.preview.cron', { cron: cronPreview ?? '-' })}</p>
                <p>{t('project.scheduler.preview.nextRun', { value: nextRunPreview ?? '-' })}</p>
                {previewError && <p className="mt-1 text-red-600">{previewError}</p>}
            </div>
        </div>
    );
}
