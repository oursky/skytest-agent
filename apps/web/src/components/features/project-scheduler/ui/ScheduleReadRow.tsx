'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/shared';
import { formatDateTimeCompact } from '@/utils/time/dateFormatter';
import { type ScheduleRecord, type ScheduleTestCaseSummary } from '@/types';
import { humanizeSchedule } from '../model/schedule-form';
import RunStatusBadge from './RunStatusBadge';

interface ScheduleReadRowProps {
    schedule: ScheduleRecord;
    canManageProject: boolean;
    isToggling?: boolean;
    t: (key: string, values?: Record<string, string | number>) => string;
    onEdit: () => void;
    onToggleEnabled: () => void;
    onDelete: () => void;
}

function testCaseHref(schedule: ScheduleRecord, testCase: ScheduleTestCaseSummary): string {
    if (testCase.lastRunId) {
        return `/test-cases/${testCase.id}/history/${testCase.lastRunId}`;
    }
    return `/run?testCaseId=${testCase.id}&projectId=${schedule.projectId}`;
}

interface SelectionDisclosureButtonProps {
    label: string;
    count: number;
    expanded: boolean;
    onToggle: () => void;
}

function SelectionDisclosureButton({ label, count, expanded, onToggle }: SelectionDisclosureButtonProps) {
    const clickable = count > 0;
    return (
        <button
            type="button"
            disabled={!clickable}
            onClick={onToggle}
            aria-expanded={clickable && expanded}
            className={`flex items-center gap-1.5 text-sm text-gray-500 ${clickable ? 'hover:text-gray-700' : 'cursor-default'}`}
        >
            <svg
                className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${clickable && expanded ? 'rotate-90' : ''} ${clickable ? '' : 'opacity-40'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
            >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span>{label}</span>
        </button>
    );
}

export default function ScheduleReadRow({
    schedule,
    canManageProject,
    isToggling = false,
    t,
    onEdit,
    onToggleEnabled,
    onDelete,
}: ScheduleReadRowProps) {
    const [groupsExpanded, setGroupsExpanded] = useState(true);
    const [casesExpanded, setCasesExpanded] = useState(true);

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
                        <p>{t('project.scheduler.preview.lastRun', { value: schedule.lastRunAt ? formatDateTimeCompact(schedule.lastRunAt) : t('project.scheduler.preview.never') })}</p>
                        <p>{t('project.scheduler.preview.nextRun', { value: schedule.nextRunAt ? formatDateTimeCompact(schedule.nextRunAt) : '-' })}</p>
                    </div>
                    <SelectionDisclosureButton
                        label={t('project.scheduler.testGroups.selectedCountLabel', { count: schedule.testGroups.length })}
                        count={schedule.testGroups.length}
                        expanded={groupsExpanded}
                        onToggle={() => setGroupsExpanded((value) => !value)}
                    />
                    <SelectionDisclosureButton
                        label={t('project.scheduler.testCases.selectedCountLabel', { count: schedule.testCases.length })}
                        count={schedule.testCases.length}
                        expanded={casesExpanded}
                        onToggle={() => setCasesExpanded((value) => !value)}
                    />
                </div>

                {canManageProject && (
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={onEdit}>{t('common.edit')}</Button>
                        <Button variant="secondary" size="sm" disabled={isToggling} onClick={onToggleEnabled}>
                            {schedule.enabled ? t('project.scheduler.disable') : t('project.scheduler.enable')}
                        </Button>
                        <Button variant="danger" size="sm" onClick={onDelete}>{t('common.delete')}</Button>
                    </div>
                )}
            </div>

            {groupsExpanded && schedule.testGroups.length > 0 && (
                <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-200">
                    {schedule.testGroups.map((testGroup) => (
                        <li key={testGroup.id} className="flex items-center gap-4 py-2.5">
                            <Link
                                href={`/test-groups/${testGroup.id}/history?projectId=${schedule.projectId}`}
                                className="min-w-0 flex-1 truncate text-sm font-medium text-blue-600 hover:underline"
                            >
                                {testGroup.displayId ? `${testGroup.displayId} · ${testGroup.name}` : testGroup.name}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {casesExpanded && schedule.testCases.length > 0 && (
                <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-200">
                    {schedule.testCases.map((testCase) => (
                        <li key={testCase.id} className="flex items-center gap-4 py-2.5">
                            <Link
                                href={testCaseHref(schedule, testCase)}
                                className="min-w-0 flex-1 truncate text-sm font-medium text-blue-600 hover:underline"
                            >
                                {testCase.displayId ? `${testCase.displayId} · ${testCase.name}` : testCase.name}
                            </Link>
                            <div className="flex w-24 flex-shrink-0 justify-start">
                                <RunStatusBadge status={testCase.status} t={t} />
                            </div>
                            <span className="w-36 flex-shrink-0 text-right text-xs text-gray-500">
                                {testCase.lastRunAt ? formatDateTimeCompact(testCase.lastRunAt) : '—'}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
