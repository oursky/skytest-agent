'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/auth-provider';
import { CustomSelect, Pagination } from '@/components/shared';
import { useI18n } from '@/i18n';
import { formatDateTimeCompact } from '@/utils/dateFormatter';

interface TeamUsageProps {
    teamId: string;
}

interface UsageRecord {
    id: string;
    type: string;
    description: string | null;
    aiActions: number;
    createdAt: string;
    project: {
        id: string;
        name: string;
    };
    actorUser: {
        id: string;
        email: string | null;
    };
    testRun: {
        id: string;
        createdAt: string;
        testCase: {
            id: string;
            displayId: string | null;
            name: string;
        } | null;
    } | null;
}

interface UsageResponse {
    records: UsageRecord[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

interface ProjectOption {
    id: string;
    name: string;
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

export default function TeamUsage({ teamId }: TeamUsageProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [records, setRecords] = useState<UsageRecord[]>([]);
    const [pagination, setPagination] = useState<UsageResponse['pagination'] | null>(null);
    const [projects, setProjects] = useState<ProjectOption[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setProjects([]);
        setSelectedProjectId('');
        setPage(1);
        setPagination(null);
        setRecords([]);
        setError(null);
    }, [teamId]);

    useEffect(() => {
        const controller = new AbortController();
        const loadProjects = async () => {
            try {
                const token = await getAccessToken();
                const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
                const response = await fetch(`/api/projects?teamId=${teamId}`, {
                    headers,
                    signal: controller.signal
                });
                if (!response.ok) {
                    return;
                }

                const data = await response.json() as ProjectOption[];
                setProjects(data.map((project) => ({ id: project.id, name: project.name })));
            } catch (error) {
                if (isAbortError(error)) {
                    return;
                }
                // ignore
            }
        };

        void loadProjects();

        return () => {
            controller.abort();
        };
    }, [getAccessToken, teamId]);

    useEffect(() => {
        if (!selectedProjectId) {
            return;
        }

        if (projects.some((project) => project.id === selectedProjectId)) {
            return;
        }

        setSelectedProjectId('');
        setPage(1);
    }, [projects, selectedProjectId]);

    useEffect(() => {
        const controller = new AbortController();
        const loadUsage = async () => {
            try {
                setIsLoading(true);
                const token = await getAccessToken();
                const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
                const url = new URL(`/api/teams/${teamId}/usage`, window.location.origin);
                url.searchParams.set('page', String(page));
                url.searchParams.set('limit', String(limit));

                if (selectedProjectId) {
                    url.searchParams.set('projectId', selectedProjectId);
                }
                if (fromDate) {
                    url.searchParams.set('from', new Date(fromDate).toISOString());
                }
                if (toDate) {
                    const inclusiveEnd = new Date(toDate);
                    inclusiveEnd.setHours(23, 59, 59, 999);
                    url.searchParams.set('to', inclusiveEnd.toISOString());
                }

                const response = await fetch(url.toString(), {
                    headers,
                    signal: controller.signal
                });
                if (!response.ok) {
                    throw new Error('Failed to load usage');
                }

                const data = await response.json() as UsageResponse;
                setRecords(data.records);
                setPagination(data.pagination);
                setError(null);
            } catch (error) {
                if (isAbortError(error)) {
                    return;
                }
                setError(t('team.usage.error.load'));
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            }
        };

        void loadUsage();

        return () => {
            controller.abort();
        };
    }, [fromDate, getAccessToken, limit, teamId, page, selectedProjectId, t, toDate]);

    const projectOptions = useMemo(
        () => [
            { value: '', label: t('team.usage.filters.allProjects') },
            ...projects.map((project) => ({ value: project.id, label: project.name })),
        ],
        [projects, t]
    );

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <div>
                <h2 className="text-base font-semibold text-gray-900">{t('team.usage.title')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('team.usage.subtitle')}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                    <span className="text-sm font-medium text-gray-700">{t('team.usage.filters.project')}</span>
                    <CustomSelect
                        value={selectedProjectId}
                        options={projectOptions}
                        onChange={(projectId) => {
                            setSelectedProjectId(projectId);
                            setPage(1);
                        }}
                        ariaLabel={t('team.usage.filters.project')}
                        fullWidth
                        buttonClassName="shadow-none"
                    />
                </div>

                <label className="space-y-1.5">
                    <span className="text-sm font-medium text-gray-700">{t('team.usage.filters.from')}</span>
                    <input
                        type="date"
                        value={fromDate}
                        onChange={(event) => {
                            setFromDate(event.target.value);
                            setPage(1);
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                </label>

                <label className="space-y-1.5">
                    <span className="text-sm font-medium text-gray-700">{t('team.usage.filters.to')}</span>
                    <input
                        type="date"
                        value={toDate}
                        onChange={(event) => {
                            setToDate(event.target.value);
                            setPage(1);
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                </label>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary"></div>
                </div>
            ) : records.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 px-6 py-12 text-center text-sm text-gray-500">
                    {t('team.usage.empty')}
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100 text-sm">
                            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="px-4 py-2.5">{t('team.usage.table.project')}</th>
                                    <th className="px-4 py-2.5">{t('team.usage.table.id')}</th>
                                    <th className="px-4 py-2.5">{t('team.usage.table.testCase')}</th>
                                    <th className="px-4 py-2.5">{t('team.usage.table.run')}</th>
                                    <th className="px-4 py-2.5">{t('usage.table.actionsCount')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 text-gray-700">
                                {records.map((record) => (
                                    <tr key={record.id} className="hover:bg-gray-50/50">
                                        <td className="px-4 py-3 align-top">{record.project.name}</td>
                                        <td className="px-4 py-3 align-top font-medium text-gray-900">
                                            {record.testRun?.testCase ? (
                                                <Link
                                                    href={`/test-cases/${record.testRun.testCase.id}/history/${record.testRun.id}`}
                                                    className="text-primary hover:underline"
                                                >
                                                    {record.testRun.testCase.displayId || '-'}
                                                </Link>
                                            ) : (
                                                '-'
                                            )}
                                        </td>
                                        <td className="px-4 py-3 align-top">
                                            {record.testRun?.testCase?.name || t('team.usage.table.noTestCase')}
                                        </td>
                                        <td className="px-4 py-3 align-top whitespace-nowrap">
                                            {record.testRun?.testCase ? (
                                                <Link
                                                    href={`/test-cases/${record.testRun.testCase.id}/history/${record.testRun.id}`}
                                                    className="text-primary hover:underline"
                                                >
                                                    {`Run - ${formatDateTimeCompact(record.testRun.createdAt)}`}
                                                </Link>
                                            ) : (
                                                <span className="text-gray-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 align-top">{record.aiActions}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {pagination && (
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
            )}

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}
        </section>
    );
}
