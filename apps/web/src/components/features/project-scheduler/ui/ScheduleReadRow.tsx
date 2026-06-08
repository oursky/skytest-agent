'use client';

import { Button } from '@/components/shared';
import { formatDateTimeCompact } from '@/utils/time/dateFormatter';
import { type ScheduleRecord } from '@/types';
import { humanizeSchedule } from '../model/schedule-form';

interface ScheduleReadRowProps {
    schedule: ScheduleRecord;
    canManageProject: boolean;
    t: (key: string, values?: Record<string, string | number>) => string;
    onEdit: () => void;
    onDelete: () => void;
}

export default function ScheduleReadRow({
    schedule,
    canManageProject,
    t,
    onEdit,
    onDelete,
}: ScheduleReadRowProps) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-gray-900">{schedule.description}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${schedule.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                            {schedule.enabled ? t('project.scheduler.status.enabled') : t('project.scheduler.status.disabled')}
                        </span>
                    </div>
                    <p className="text-sm text-gray-600">{humanizeSchedule(schedule, t)}</p>
                    <div className="text-sm text-gray-500">
                        <p>{t('project.scheduler.testCases.selectedCount', { count: schedule.testCases.length })}</p>
                        <p>{t('project.scheduler.preview.nextRun', { value: schedule.nextRunAt ? formatDateTimeCompact(schedule.nextRunAt) : '-' })}</p>
                    </div>
                </div>

                {canManageProject && (
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={onEdit}>{t('common.edit')}</Button>
                        <Button variant="danger" size="sm" onClick={onDelete}>{t('common.delete')}</Button>
                    </div>
                )}
            </div>
        </div>
    );
}
