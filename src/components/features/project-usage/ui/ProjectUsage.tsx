'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { CustomSelect, Pagination } from '@/components/shared';
import { useI18n } from '@/i18n';
import { formatDateTimeCompact } from '@/utils/dateFormatter';

interface ProjectUsageProps {
    projectId: string;
}

interface UsageRecord {
    id: string;
    type: string;
    description: string | null;
    aiActions: number;
    createdAt: string;
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
    summary: {
        totalRecords: number;
        totalAiActions: number;
        activeUsers: number;
        totalTokens: number | null;
        estimatedCostUsd: number | null;
    };
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

interface MemberOption {
    id: string;
    userId: string;
    email: string | null;
}

interface TestCaseOption {
    id: string;
    name: string;
}

export default function ProjectUsage({ projectId }: ProjectUsageProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [records, setRecords] = useState<UsageRecord[]>([]);
    const [summary, setSummary] = useState<UsageResponse['summary'] | null>(null);
    const [pagination, setPagination] = useState<UsageResponse['pagination'] | null>(null);
    const [members, setMembers] = useState<MemberOption[]>([]);
    const [testCases, setTestCases] = useState<TestCaseOption[]>([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [selectedTestCaseId, setSelectedTestCaseId] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchFilters = async () => {
            try {
                const token = await getAccessToken();
                const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

                const [membersResponse, testCasesResponse] = await Promise.all([
                    fetch(`/api/projects/${projectId}/members`, { headers }),
                    fetch(`/api/projects/${projectId}/test-cases`, { headers }),
                ]);

                if (!membersResponse.ok || !testCasesResponse.ok) {
                    return;
                }

                const [membersData, testCasesData] = await Promise.all([
                    membersResponse.json() as Promise<MemberOption[]>,
                    testCasesResponse.json() as Promise<TestCaseOption[]>,
                ]);

                setMembers(membersData);
                setTestCases(testCasesData.map((item) => ({ id: item.id, name: item.name })));
            } catch {
                // ignore filter bootstrap failures
            }
        };

        void fetchFilters();
    }, [getAccessToken, projectId]);

    useEffect(() => {
        const fetchUsage = async () => {
            try {
                setIsLoading(true);
                const token = await getAccessToken();
                const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
                const url = new URL(`/api/projects/${projectId}/usage`, window.location.origin);
                url.searchParams.set('page', String(page));
                url.searchParams.set('limit', String(limit));

                if (selectedUserId) {
                    url.searchParams.set('actorUserId', selectedUserId);
                }
                if (selectedTestCaseId) {
                    url.searchParams.set('testCaseId', selectedTestCaseId);
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
                setSummary(data.summary);
                setPagination(data.pagination);
                setError(null);
            } catch {
                setError(t('project.usage.error.load'));
            } finally {
                setIsLoading(false);
            }
        };

        void fetchUsage();
    }, [fromDate, getAccessToken, limit, page, projectId, selectedTestCaseId, selectedUserId, t, toDate]);

    const cards = useMemo(() => {
        if (!summary) {
            return [];
        }

        return [
            { label: t('project.usage.summary.records'), value: String(summary.totalRecords) },
            { label: t('project.usage.summary.actions'), value: String(summary.totalAiActions) },
            { label: t('project.usage.summary.members'), value: String(summary.activeUsers) },
            { label: t('project.usage.summary.tokens'), value: summary.totalTokens === null ? t('project.usage.notReported') : String(summary.totalTokens) },
            { label: t('project.usage.summary.cost'), value: summary.estimatedCostUsd === null ? t('project.usage.notReported') : `$${summary.estimatedCostUsd.toFixed(2)}` },
        ];
    }, [summary, t]);

    const resetPage = () => setPage(1);
    const memberOptions = useMemo(
        () => [
            { value: '', label: t('project.usage.filters.allUsers') },
            ...members.map((member) => ({
                value: member.userId,
                label: member.email || t('project.members.unknownEmail'),
            })),
        ],
        [members, t]
    );
    const testCaseOptions = useMemo(
        () => [
            { value: '', label: t('project.usage.filters.allTestCases') },
            ...testCases.map((testCase) => ({
                value: testCase.id,
                label: testCase.name,
            })),
        ],
        [t, testCases]
    );

    return (
        <section className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {cards.map((card) => (
                    <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="text-sm text-gray-500">{card.label}</div>
                        <div className="mt-2 text-2xl font-semibold text-gray-900">{card.value}</div>
                    </div>
                ))}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <label className="space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('project.usage.filters.user')}</span>
                        <CustomSelect
                            value={selectedUserId}
                            options={memberOptions}
                            onChange={(userId) => {
                                setSelectedUserId(userId);
                                resetPage();
                            }}
                            ariaLabel={t('project.usage.filters.user')}
                            fullWidth
                            buttonClassName="shadow-none"
                        />
                    </label>

                    <label className="space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('project.usage.filters.testCase')}</span>
                        <CustomSelect
                            value={selectedTestCaseId}
                            options={testCaseOptions}
                            onChange={(testCaseId) => {
                                setSelectedTestCaseId(testCaseId);
                                resetPage();
                            }}
                            ariaLabel={t('project.usage.filters.testCase')}
                            fullWidth
                            buttonClassName="shadow-none"
                        />
                    </label>

                    <label className="space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('project.usage.filters.from')}</span>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(event) => {
                                setFromDate(event.target.value);
                                resetPage();
                            }}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                    </label>

                    <label className="space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('project.usage.filters.to')}</span>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(event) => {
                                setToDate(event.target.value);
                                resetPage();
                            }}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                    </label>
                </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="grid grid-cols-[180px,1.5fr,120px,1fr,1fr] gap-4 border-b border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-500">
                    <div>{t('usage.table.dateTime')}</div>
                    <div>{t('usage.table.description')}</div>
                    <div>{t('usage.table.actionsCount')}</div>
                    <div>{t('project.usage.table.user')}</div>
                    <div>{t('project.usage.table.testCase')}</div>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                ) : records.length === 0 ? (
                    <div className="px-4 py-16 text-center text-sm text-gray-500">{t('usage.noUsageRecords')}</div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {records.map((record) => (
                            <div key={record.id} className="grid grid-cols-[180px,1.5fr,120px,1fr,1fr] gap-4 px-4 py-3 text-sm text-gray-700">
                                <div>{formatDateTimeCompact(record.createdAt)}</div>
                                <div>{record.description || t('project.usage.table.noDescription')}</div>
                                <div>{record.aiActions}</div>
                                <div>{record.actorUser.email || t('project.members.unknownEmail')}</div>
                                <div>{record.testRun?.testCase?.name || t('project.usage.table.noTestCase')}</div>
                            </div>
                        ))}
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
            </div>

            {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}
        </section>
    );
}
