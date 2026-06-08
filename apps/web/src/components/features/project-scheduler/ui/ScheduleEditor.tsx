'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/shared';
import { formatDateTimeCompact } from '@/utils/time/dateFormatter';
import type { ScheduleRecord, ScheduleUpsertInput } from '@/types';
import {
    createDefaultScheduleForm,
    createSchedulePreview,
    mapScheduleToForm,
    type ProjectScheduleFormState,
    type ProjectScheduleTestCaseOption,
} from '../model/schedule-form';
import IntervalPatternField from './IntervalPatternField';
import TestCasePicker from './TestCasePicker';
import TimezoneSelect from './TimezoneSelect';

interface ScheduleEditorProps {
    schedule?: ScheduleRecord;
    availableTestCases: ProjectScheduleTestCaseOption[];
    isSaving: boolean;
    t: (key: string, values?: Record<string, string | number>) => string;
    onCancel: () => void;
    onSave: (input: ScheduleUpsertInput) => Promise<void>;
}

export default function ScheduleEditor({
    schedule,
    availableTestCases,
    isSaving,
    t,
    onCancel,
    onSave,
}: ScheduleEditorProps) {
    const [form, setForm] = useState<ProjectScheduleFormState>(() => (
        schedule ? mapScheduleToForm(schedule) : createDefaultScheduleForm()
    ));
    const [error, setError] = useState<string | null>(null);

    const preview = useMemo(() => createSchedulePreview(form), [form]);

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="grid gap-4">
                <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{t('project.scheduler.fields.description')}</label>
                    <input
                        type="text"
                        value={form.description}
                        onChange={(event) => setForm((previous) => ({ ...previous, description: event.target.value }))}
                        className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
                    />
                </div>

                <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{t('project.scheduler.fields.timezone')}</label>
                    <TimezoneSelect
                        value={form.timezone}
                        onChange={(value) => setForm((previous) => ({ ...previous, timezone: value }))}
                    />
                </div>

                <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{t('project.scheduler.fields.interval')}</label>
                    <IntervalPatternField
                        patternType={form.patternType}
                        time={form.time}
                        weekday={form.weekday}
                        dayOfMonth={form.dayOfMonth}
                        customCron={form.customCron}
                        cronPreview={preview.cronExpression}
                        nextRunPreview={preview.nextRunAt ? formatDateTimeCompact(preview.nextRunAt) : null}
                        previewError={preview.error}
                        t={t}
                        onPatternTypeChange={(value) => setForm((previous) => ({ ...previous, patternType: value }))}
                        onTimeChange={(value) => setForm((previous) => ({ ...previous, time: value }))}
                        onWeekdayChange={(value) => setForm((previous) => ({ ...previous, weekday: value }))}
                        onDayOfMonthChange={(value) => setForm((previous) => ({ ...previous, dayOfMonth: value }))}
                        onCustomCronChange={(value) => setForm((previous) => ({ ...previous, customCron: value }))}
                    />
                </div>

                <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{t('project.scheduler.fields.testCases')}</label>
                    <TestCasePicker
                        testCases={availableTestCases}
                        selectedIds={form.testCaseIds}
                        t={t}
                        onChange={(nextSelectedIds) => setForm((previous) => ({ ...previous, testCaseIds: nextSelectedIds }))}
                    />
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={(event) => setForm((previous) => ({ ...previous, enabled: event.target.checked }))}
                        className="h-4 w-4"
                    />
                    <span>{t('project.scheduler.fields.enabled')}</span>
                </label>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="primary"
                        size="sm"
                        disabled={isSaving}
                        onClick={() => {
                            setError(null);
                            if (!form.description.trim()) {
                                setError(t('project.scheduler.validation.descriptionRequired'));
                                return;
                            }
                            if (form.testCaseIds.length === 0) {
                                setError(t('project.scheduler.validation.testCasesRequired'));
                                return;
                            }
                            void onSave({
                                description: form.description,
                                timezone: form.timezone,
                                patternType: form.patternType,
                                time: form.time,
                                weekday: form.weekday,
                                dayOfMonth: form.dayOfMonth,
                                customCron: form.customCron,
                                enabled: form.enabled,
                                testCaseIds: form.testCaseIds,
                            });
                        }}
                    >
                        {isSaving ? t('project.scheduler.saving') : t('common.save')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onCancel}>{t('project.scheduler.discard')}</Button>
                </div>
            </div>
        </div>
    );
}
