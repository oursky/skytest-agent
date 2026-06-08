'use client';

import { useAuth } from '@/app/auth-provider';
import { Pagination } from '@/components/shared';
import { buildAuthHeaders } from '@/components/features/test-configurations/model/config-utils';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { type ProjectScheduleTestCaseOption } from '../model/schedule-form';

const SERVER_SEARCH_THRESHOLD = 500;
const DEFAULT_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 250;

interface TestCaseSummaryResponse {
    data: ProjectScheduleTestCaseOption[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

interface TestCasePickerProps {
    projectId: string;
    testCases: ProjectScheduleTestCaseOption[];
    selectedIds: string[];
    disabled?: boolean;
    t: (key: string, values?: Record<string, string | number>) => string;
    onChange: (nextSelectedIds: string[]) => void;
}

export default function TestCasePicker({
    projectId,
    testCases,
    selectedIds,
    disabled = false,
    t,
    onChange,
}: TestCasePickerProps) {
    const { getAccessToken } = useAuth();
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [showSelectedOnly, setShowSelectedOnly] = useState(false);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(DEFAULT_LIMIT);
    const [remoteData, setRemoteData] = useState<TestCaseSummaryResponse | null>(null);
    const [isLoadingRemote, setIsLoadingRemote] = useState(false);
    const [remoteError, setRemoteError] = useState<string | null>(null);
    const deferredSearch = useDeferredValue(debouncedSearch);
    const useServerMode = testCases.length > SERVER_SEARCH_THRESHOLD;

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearch(search);
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [search]);

    useEffect(() => {
        setPage(1);
    }, [deferredSearch, showSelectedOnly]);

    useEffect(() => {
        if (!useServerMode || showSelectedOnly) {
            setRemoteError(null);
            setIsLoadingRemote(false);
            return;
        }

        const controller = new AbortController();

        const fetchRemoteTestCases = async () => {
            try {
                setIsLoadingRemote(true);
                setRemoteError(null);
                const token = await getAccessToken();
                const params = new URLSearchParams({
                    summary: '1',
                    page: String(page),
                    limit: String(limit),
                });
                if (deferredSearch.trim()) {
                    params.set('search', deferredSearch.trim());
                }

                const response = await fetch(`/api/projects/${projectId}/test-cases?${params.toString()}`, {
                    headers: buildAuthHeaders(token),
                    signal: controller.signal,
                });

                if (!response.ok) {
                    throw new Error('Failed to load test cases');
                }

                const payload = await response.json() as TestCaseSummaryResponse;
                setRemoteData(payload);
            } catch (error) {
                if (controller.signal.aborted) {
                    return;
                }
                console.error('Failed to fetch scheduler test cases', error);
                setRemoteError(t('project.scheduler.testCases.loadFailed'));
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoadingRemote(false);
                }
            }
        };

        void fetchRemoteTestCases();

        return () => {
            controller.abort();
        };
    }, [deferredSearch, getAccessToken, limit, page, projectId, showSelectedOnly, t, useServerMode]);

    const selectedTestCases = useMemo(() => {
        const selectedSet = new Set(selectedIds);
        const normalizedSearch = deferredSearch.trim().toLowerCase();

        return testCases.filter((testCase) => {
            if (!selectedSet.has(testCase.id)) {
                return false;
            }
            if (!normalizedSearch) {
                return true;
            }
            return `${testCase.displayId ?? ''} ${testCase.name}`.toLowerCase().includes(normalizedSearch);
        });
    }, [deferredSearch, selectedIds, testCases]);

    const localFilteredTestCases = useMemo(() => {
        const normalizedSearch = deferredSearch.trim().toLowerCase();

        return testCases.filter((testCase) => {
            if (showSelectedOnly && !selectedIds.includes(testCase.id)) {
                return false;
            }
            if (!normalizedSearch) {
                return true;
            }
            return `${testCase.displayId ?? ''} ${testCase.name}`.toLowerCase().includes(normalizedSearch);
        });
    }, [deferredSearch, selectedIds, showSelectedOnly, testCases]);

    const visibleTestCases = showSelectedOnly
        ? selectedTestCases
        : useServerMode
            ? remoteData?.data ?? []
            : localFilteredTestCases;

    const pagination = remoteData?.pagination ?? {
        page,
        limit,
        total: visibleTestCases.length,
        totalPages: 1,
    };

    const allFilteredSelected = visibleTestCases.length > 0
        && visibleTestCases.every((testCase) => selectedIds.includes(testCase.id));

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
                                                visibleTestCases.forEach((testCase) => next.add(testCase.id));
                                                onChange(Array.from(next));
                                                return;
                                            }
                                            onChange(selectedIds.filter((id) => !visibleTestCases.some((testCase) => testCase.id === id)));
                                        }}
                                        disabled={disabled || visibleTestCases.length === 0}
                                        className="h-4 w-4"
                                    />
                                </th>
                                <th className="px-3 py-2 text-left font-medium text-gray-500">{t('project.scheduler.testCases.id')}</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-500">{t('project.scheduler.testCases.name')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {visibleTestCases.map((testCase) => (
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
                    {isLoadingRemote && useServerMode && !showSelectedOnly && (
                        <div className="px-4 py-8 text-center text-sm text-gray-500">
                            {t('project.scheduler.testCases.loading')}
                        </div>
                    )}
                    {!isLoadingRemote && remoteError && useServerMode && !showSelectedOnly && (
                        <div className="px-4 py-8 text-center text-sm text-red-600">
                            {remoteError}
                        </div>
                    )}
                    {!isLoadingRemote && !remoteError && visibleTestCases.length === 0 && (
                        <div className="px-4 py-8 text-center text-sm text-gray-500">
                            {t('project.scheduler.testCases.empty')}
                        </div>
                    )}
                </div>
                {useServerMode && !showSelectedOnly && !remoteError && (
                    <Pagination
                        page={pagination.page}
                        limit={pagination.limit}
                        total={pagination.total}
                        totalPages={pagination.totalPages}
                        onPageChange={setPage}
                        onLimitChange={setLimit}
                    />
                )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                <p>{t('project.scheduler.testCases.selectedCount', { count: selectedIds.length })}</p>
                {useServerMode && !showSelectedOnly && (
                    <p>{t('project.scheduler.testCases.remoteMode')}</p>
                )}
            </div>
        </div>
    );
}
