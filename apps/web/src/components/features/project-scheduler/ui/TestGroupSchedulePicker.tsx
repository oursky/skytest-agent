'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import type { TestGroupSummary } from '@/types';

interface TestGroupSchedulePickerProps {
    projectId: string;
    selectedIds: string[];
    disabled?: boolean;
    t: (key: string, values?: Record<string, string | number>) => string;
    onChange: (nextSelectedIds: string[]) => void;
}

export default function TestGroupSchedulePicker({ projectId, selectedIds, disabled = false, t, onChange }: TestGroupSchedulePickerProps) {
    const { getAccessToken } = useAuth();
    const [groups, setGroups] = useState<TestGroupSummary[]>([]);
    const [search, setSearch] = useState('');
    const [showSelectedOnly, setShowSelectedOnly] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/test-groups?limit=100`);
                if (response.ok && !cancelled) {
                    const body = await response.json() as { data?: TestGroupSummary[] };
                    setGroups(body.data ?? []);
                }
            } catch {
                // Leave empty on failure; test groups are optional for a schedule.
            }
        })();
        return () => { cancelled = true; };
    }, [projectId, getAccessToken]);

    const visibleGroups = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();
        return groups.filter((group) => {
            if (showSelectedOnly && !selectedIds.includes(group.id)) {
                return false;
            }
            if (!normalizedSearch) {
                return true;
            }
            return `${group.displayId ?? ''} ${group.name}`.toLowerCase().includes(normalizedSearch);
        });
    }, [groups, search, selectedIds, showSelectedOnly]);

    const allFilteredSelected = visibleGroups.length > 0
        && visibleGroups.every((group) => selectedIds.includes(group.id));

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('project.scheduler.testGroups.search')}
                    disabled={disabled}
                    className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm sm:max-w-sm"
                />
                <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                        type="checkbox"
                        checked={showSelectedOnly}
                        onChange={(event) => setShowSelectedOnly(event.target.checked)}
                        disabled={disabled}
                        className="h-4 w-4"
                    />
                    <span>{t('project.scheduler.testCases.selectedOnly')}</span>
                </label>
            </div>

            <div className="rounded-md border border-gray-200">
                <div className="max-h-72 overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="sticky top-0 bg-gray-50">
                            <tr>
                                <th className="w-12 px-3 py-2 text-left">
                                    <input
                                        type="checkbox"
                                        checked={allFilteredSelected}
                                        onChange={(event) => {
                                            if (event.target.checked) {
                                                const next = new Set(selectedIds);
                                                visibleGroups.forEach((group) => next.add(group.id));
                                                onChange(Array.from(next));
                                                return;
                                            }
                                            onChange(selectedIds.filter((id) => !visibleGroups.some((group) => group.id === id)));
                                        }}
                                        disabled={disabled || visibleGroups.length === 0}
                                        className="h-4 w-4"
                                    />
                                </th>
                                <th className="px-3 py-2 text-left font-medium text-gray-500">{t('project.scheduler.testCases.id')}</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-500">{t('project.scheduler.testCases.name')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {visibleGroups.map((group) => (
                                <tr key={group.id}>
                                    <td className="px-3 py-2">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(group.id)}
                                            onChange={(event) => {
                                                const next = event.target.checked
                                                    ? [...selectedIds, group.id]
                                                    : selectedIds.filter((id) => id !== group.id);
                                                onChange(Array.from(new Set(next)));
                                            }}
                                            disabled={disabled}
                                            className="h-4 w-4"
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-gray-600">{group.displayId || '-'}</td>
                                    <td className="px-3 py-2 text-gray-900">{group.name}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {visibleGroups.length === 0 && (
                        <div className="px-4 py-8 text-center text-sm text-gray-500">
                            {t('project.scheduler.testGroups.empty')}
                        </div>
                    )}
                </div>
            </div>

            <p className="text-xs text-gray-500">{t('project.scheduler.testCases.selectedCount', { count: selectedIds.length })}</p>
        </div>
    );
}
