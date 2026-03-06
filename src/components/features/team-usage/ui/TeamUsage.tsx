'use client';

import { useEffect, useMemo, useState } from 'react';
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
        testCase: {
            id: string;
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
        const loadProjects = async () => {
            try {
                const token = await getAccessToken();
                const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
                const response = await fetch(`/api/projects?teamId=${teamId}`, { headers });
                if (!response.ok) {
                    return;
                }

                const data = await response.json() as ProjectOption[];
                setProjects(data.map((project) => ({ id: project.id, name: project.name })));
            } catch {
                // ignore
            }
        };

        void loadProjects();
    }, [getAccessToken, teamId]);

    useEffect(() => {
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

                const response = await fetch(url.toString(), { headers });
                if (!response.ok) {
                    throw new Error('Failed to load usage');
                }

                const data = await response.json() as UsageResponse;
                setRecords(data.records);
                setPagination(data.pagination);
                setError(null);
            } catch {
                setError(t('team.usage.error.load'));
            } finally {
                setIsLoading(false);
            }
        };

        void loadUsage();
    }, [fromDate, getAccessToken, limit, teamId, page, selectedProjectId, t, toDate]);

    const projectOptions = useMemo(
        () => [
            { value: '', label: t('team.usage.filters.allProjects') },
            ...projects.map((project) => ({ value: project.id, label: project.name })),
        ],
        [projects, t]
    );

    return (
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">{t('team.usage.title')}</h3>
            <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-2">
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
                </label>

                <label className="space-y-2">
                    <span className="text-sm font-medium text-gray-700">{t('team.usage.filters.from')}</span>
                    <input
                        type="date"
                        value={fromDate}
                        onChange={(event) => {
                            setFromDate(event.target.value);
                            setPage(1);
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                </label>

                <label className="space-y-2">
                    <span className="text-sm font-medium text-gray-700">{t('team.usage.filters.to')}</span>
                    <input
                        type="date"
                        value={toDate}
                        onChange={(event) => {
                            setToDate(event.target.value);
                            setPage(1);
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                </label>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
                </div>
            ) : records.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 px-6 py-16 text-center text-sm text-gray-500">
                    {t('team.usage.empty')}
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100 text-sm">
                            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="px-6 py-3">{t('team.usage.table.run')}</th>
                                    <th className="px-6 py-3">{t('team.usage.table.project')}</th>
                                    <th className="px-6 py-3">{t('team.usage.table.testCase')}</th>
                                    <th className="px-6 py-3">{t('usage.table.description')}</th>
                                    <th className="px-6 py-3">{t('usage.table.actionsCount')}</th>
                                    <th className="px-6 py-3">{t('usage.table.dateTime')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white text-gray-700">
                                {records.map((record) => (
                                    <tr key={record.id}>
                                        <td className="px-6 py-4 align-top font-medium text-gray-900">
                                            {record.testRun?.id ?? '-'}
                                        </td>
                                        <td className="px-6 py-4 align-top">{record.project.name}</td>
                                        <td className="px-6 py-4 align-top">
                                            {record.testRun?.testCase?.name || t('team.usage.table.noTestCase')}
                                        </td>
                                        <td className="px-6 py-4 align-top">
                                            {record.description || t('team.usage.table.noDescription')}
                                        </td>
                                        <td className="px-6 py-4 align-top">{record.aiActions}</td>
                                        <td className="px-6 py-4 align-top">{formatDateTimeCompact(record.createdAt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

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

            {error && (
                <div className="border-t border-red-100 bg-red-50 px-6 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}
        </section>
    );
}
