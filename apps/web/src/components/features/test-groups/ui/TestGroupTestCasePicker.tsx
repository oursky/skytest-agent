'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { Pagination } from '@/components/shared';
import { useI18n } from '@/i18n';
import {
    moveSelectedTestCase,
    toggleSelectedTestCase,
    toggleVisibleTestCases,
    type TestGroupTestCaseOption,
} from '../model/test-case-selection';
import TestGroupTestCaseTableRows from './TestGroupTestCaseTableRows';

const DEFAULT_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 250;

interface TestCaseSummaryResponse {
    data: TestGroupTestCaseOption[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

interface TestGroupTestCasePickerProps {
    projectId: string;
    selectedIds: string[];
    selectedOptions: TestGroupTestCaseOption[];
    onChange: (testCaseIds: string[]) => void;
    readOnly?: boolean;
    loginSessions: { loginFlowId: string; name: string }[];
    resolveLoginFlowName: (loginFlowId: string) => string;
}

function mergeOptions(
    current: Record<string, TestGroupTestCaseOption>,
    options: TestGroupTestCaseOption[],
): Record<string, TestGroupTestCaseOption> {
    const next = { ...current };
    options.forEach((option) => {
        next[option.id] = { ...next[option.id], ...option };
    });
    return next;
}

export default function TestGroupTestCasePicker({
    projectId,
    selectedIds,
    selectedOptions,
    onChange,
    readOnly = false,
    loginSessions,
    resolveLoginFlowName,
}: TestGroupTestCasePickerProps) {
    const { t } = useI18n();
    const { getAccessToken } = useAuth();
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [showSelectedOnly, setShowSelectedOnly] = useState(false);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(DEFAULT_LIMIT);
    const [remoteData, setRemoteData] = useState<TestCaseSummaryResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [remoteOptionCache, setRemoteOptionCache] = useState<Record<string, TestGroupTestCaseOption>>({});
    const optionCache = useMemo(() => (
        mergeOptions(mergeOptions({}, selectedOptions), Object.values(remoteOptionCache))
    ), [remoteOptionCache, selectedOptions]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearch(search);
        }, SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timeoutId);
    }, [search]);

    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, showSelectedOnly]);

    useEffect(() => {
        if (showSelectedOnly) {
            setLoadError(false);
            setIsLoading(false);
            return;
        }

        const controller = new AbortController();
        const fetchPage = async () => {
            setIsLoading(true);
            setLoadError(false);
            setRemoteData(null);
            const params = new URLSearchParams({
                summary: '1',
                kind: 'TEST',
                page: String(page),
                limit: String(limit),
            });
            if (debouncedSearch.trim()) {
                params.set('search', debouncedSearch.trim());
            }

            try {
                const response = await fetchWithAccessToken(
                    getAccessToken,
                    `/api/projects/${projectId}/test-cases?${params.toString()}`,
                    { signal: controller.signal },
                );
                if (!response.ok) {
                    throw new Error('Failed to load test cases');
                }
                const payload = await response.json() as TestCaseSummaryResponse;
                setRemoteData(payload);
                setRemoteOptionCache((current) => mergeOptions(current, payload.data));
            } catch {
                if (!controller.signal.aborted) {
                    setLoadError(true);
                    setRemoteData(null);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            }
        };

        void fetchPage();
        return () => controller.abort();
    }, [debouncedSearch, getAccessToken, limit, page, projectId, showSelectedOnly]);

    const selectedCases = useMemo(() => {
        const query = debouncedSearch.trim().toLowerCase();
        return selectedIds
            .map((id) => optionCache[id])
            .filter((option): option is TestGroupTestCaseOption => Boolean(option))
            .filter((option) => !query || `${option.displayId ?? ''} ${option.name}`.toLowerCase().includes(query));
    }, [debouncedSearch, optionCache, selectedIds]);

    const selectedTotalPages = Math.max(1, Math.ceil(selectedCases.length / limit));
    const selectedPage = Math.min(page, selectedTotalPages);
    const visibleCases = showSelectedOnly
        ? selectedCases.slice((selectedPage - 1) * limit, selectedPage * limit)
        : remoteData?.data ?? [];
    const pagination = showSelectedOnly
        ? {
            page: selectedPage,
            limit,
            total: selectedCases.length,
            totalPages: selectedTotalPages,
        }
        : remoteData?.pagination ?? { page, limit, total: 0, totalPages: 1 };
    const visibleIds = visibleCases.map((testCase) => testCase.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

    const mappedSessionName = (loginFlowId: string | null, reuseEnabled: boolean): string | null => {
        if (!loginFlowId || !reuseEnabled) {
            return null;
        }
        return loginSessions.find((session) => session.loginFlowId === loginFlowId)?.name ?? null;
    };

    return (
        <div className="space-y-3">
            <div>
                <h3 className="text-sm font-medium text-gray-700">{t('testGroup.items')}</h3>
                <p className="mt-1 text-xs text-gray-500">{t('testGroup.items.orderHint')}</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('testGroup.items.search')}
                    className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm sm:max-w-sm"
                />
                <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                        type="checkbox"
                        checked={showSelectedOnly}
                        onChange={(event) => setShowSelectedOnly(event.target.checked)}
                        className="h-4 w-4"
                    />
                    <span>{t('testGroup.items.selectedOnly')}</span>
                </label>
            </div>

            <div className="overflow-hidden rounded-md border border-gray-200">
                <div className="max-h-96 overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="sticky top-0 z-10 bg-gray-50">
                            <tr>
                                <th className="w-12 px-3 py-2 text-left">
                                    <input
                                        type="checkbox"
                                        checked={allVisibleSelected}
                                        onChange={(event) => onChange(toggleVisibleTestCases(selectedIds, visibleIds, event.target.checked))}
                                        disabled={readOnly || visibleIds.length === 0}
                                        aria-label={t('testGroup.items.selectPage')}
                                        className="h-4 w-4"
                                    />
                                </th>
                                <th className="w-16 px-3 py-2 text-left font-medium text-gray-500">{t('testGroup.items.order')}</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-500">{t('testGroup.items.id')}</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-500">{t('testGroup.items.name')}</th>
                                <th className="w-28 px-3 py-2 text-left font-medium text-gray-500">{t('testGroup.sessions')}</th>
                                <th className="w-24 px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {visibleCases.map((testCase) => {
                                const selectedIndex = selectedIds.indexOf(testCase.id);
                                const isSelected = selectedIndex >= 0;
                                const targets = optionCache[testCase.id]?.targets ?? testCase.targets ?? [];
                                const isExpanded = expandedId === testCase.id;
                                return (
                                    <TestGroupTestCaseTableRows
                                        key={testCase.id}
                                        testCase={testCase}
                                        targets={targets}
                                        isSelected={isSelected}
                                        selectedIndex={selectedIndex}
                                        selectedCount={selectedIds.length}
                                        isExpanded={isExpanded}
                                        showOrderActions={showSelectedOnly}
                                        readOnly={readOnly}
                                        toggleExpanded={() => setExpandedId(isExpanded ? null : testCase.id)}
                                        toggleSelected={(checked) => onChange(toggleSelectedTestCase(selectedIds, testCase.id, checked))}
                                        move={(delta) => onChange(moveSelectedTestCase(selectedIds, testCase.id, delta))}
                                        mappedSessionName={mappedSessionName}
                                        resolveLoginFlowName={resolveLoginFlowName}
                                    />
                                );
                            })}
                        </tbody>
                    </table>
                    {isLoading && !showSelectedOnly && (
                        <div className="px-4 py-8 text-center text-sm text-gray-500">{t('testGroup.items.loading')}</div>
                    )}
                    {!isLoading && loadError && !showSelectedOnly && (
                        <div className="px-4 py-8 text-center text-sm text-red-600">{t('testGroup.items.loadFailed')}</div>
                    )}
                    {!isLoading && !loadError && visibleCases.length === 0 && (
                        <div className="px-4 py-8 text-center text-sm text-gray-500">
                            {debouncedSearch.trim() || showSelectedOnly
                                ? t('testGroup.items.noResults')
                                : t('testGroup.items.empty')}
                        </div>
                    )}
                </div>
                {pagination.total > 0 && (
                    <Pagination
                        page={pagination.page}
                        limit={pagination.limit}
                        total={pagination.total}
                        totalPages={pagination.totalPages}
                        onPageChange={setPage}
                        onLimitChange={(nextLimit) => {
                            setLimit(nextLimit);
                            setPage(1);
                        }}
                    />
                )}
            </div>

            <p className="text-xs text-gray-500">{t('testGroup.items.selectedCount', { count: selectedIds.length })}</p>
        </div>
    );
}
