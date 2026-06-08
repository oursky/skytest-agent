'use client';

import { useMemo, useState } from 'react';
import { type ProjectScheduleTestCaseOption } from '../model/schedule-form';

interface TestCasePickerProps {
    testCases: ProjectScheduleTestCaseOption[];
    selectedIds: string[];
    disabled?: boolean;
    t: (key: string, values?: Record<string, string | number>) => string;
    onChange: (nextSelectedIds: string[]) => void;
}

export default function TestCasePicker({
    testCases,
    selectedIds,
    disabled = false,
    t,
    onChange,
}: TestCasePickerProps) {
    const [search, setSearch] = useState('');
    const [showSelectedOnly, setShowSelectedOnly] = useState(false);

    const filteredTestCases = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();
        return testCases.filter((testCase) => {
            if (showSelectedOnly && !selectedIds.includes(testCase.id)) {
                return false;
            }
            if (!normalizedSearch) {
                return true;
            }
            return `${testCase.displayId ?? ''} ${testCase.name}`.toLowerCase().includes(normalizedSearch);
        });
    }, [search, selectedIds, showSelectedOnly, testCases]);

    const allFilteredSelected = filteredTestCases.length > 0
        && filteredTestCases.every((testCase) => selectedIds.includes(testCase.id));

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('project.scheduler.testCases.search')}
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
                                                filteredTestCases.forEach((testCase) => next.add(testCase.id));
                                                onChange(Array.from(next));
                                                return;
                                            }
                                            onChange(selectedIds.filter((id) => !filteredTestCases.some((testCase) => testCase.id === id)));
                                        }}
                                        disabled={disabled || filteredTestCases.length === 0}
                                        className="h-4 w-4"
                                    />
                                </th>
                                <th className="px-3 py-2 text-left font-medium text-gray-500">{t('project.scheduler.testCases.id')}</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-500">{t('project.scheduler.testCases.name')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredTestCases.map((testCase) => (
                                <tr key={testCase.id}>
                                    <td className="px-3 py-2">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(testCase.id)}
                                            onChange={(event) => {
                                                const next = event.target.checked
                                                    ? [...selectedIds, testCase.id]
                                                    : selectedIds.filter((id) => id !== testCase.id);
                                                onChange(Array.from(new Set(next)));
                                            }}
                                            disabled={disabled}
                                            className="h-4 w-4"
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-gray-600">{testCase.displayId || '-'}</td>
                                    <td className="px-3 py-2 text-gray-900">{testCase.name}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredTestCases.length === 0 && (
                        <div className="px-4 py-8 text-center text-sm text-gray-500">
                            {t('project.scheduler.testCases.empty')}
                        </div>
                    )}
                </div>
            </div>

            <p className="text-xs text-gray-500">
                {t('project.scheduler.testCases.selectedCount', { count: selectedIds.length })}
            </p>
        </div>
    );
}
