'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { Pagination } from '@/components/shared';
import { Breadcrumbs } from '@/components/layout';
import { getStatusBadgeClass } from '@/utils/status/statusBadge';
import { formatDateTime } from '@/utils/time/dateFormatter';
import { parsePageSize } from '@/utils/pagination/pagination';
import { isRunActiveStatus, type TestGroupSessionSummary } from '@/types';
import { isSchedulerTriggered } from '@/lib/test-runs/trigger-label';

interface SessionsResponse {
    groupName?: string;
    projectName?: string;
    data: TestGroupSessionSummary[];
    pagination?: { page: number; limit: number; total: number; totalPages: number };
}

export default function TestGroupHistoryPage({ params }: { params: Promise<{ groupId: string }> }) {
    const { groupId } = use(params);
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const projectId = searchParams.get('projectId');
    const { t } = useI18n();
    const { getAccessToken } = useAuth();

    const pageSize = parsePageSize(searchParams.get('limit'));
    const parsedPage = Number.parseInt(searchParams.get('page') || '1', 10);
    const currentPage = Number.isNaN(parsedPage) ? 1 : Math.max(1, parsedPage);

    const [sessions, setSessions] = useState<TestGroupSessionSummary[]>([]);
    const [groupName, setGroupName] = useState('');
    const [projectName, setProjectName] = useState('');
    const [total, setTotal] = useState(0);
    const [loaded, setLoaded] = useState(false);

    const fetchSessions = useCallback(async () => {
        if (!projectId) return;
        const query = new URLSearchParams({ page: String(currentPage), limit: String(pageSize) });
        const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/test-groups/${groupId}/sessions?${query.toString()}`);
        if (response.ok) {
            const result = await response.json() as SessionsResponse;
            setSessions(Array.isArray(result.data) ? result.data : []);
            setTotal(result.pagination?.total ?? 0);
            if (typeof result.groupName === 'string') setGroupName(result.groupName);
            if (typeof result.projectName === 'string') setProjectName(result.projectName);
        }
        setLoaded(true);
    }, [projectId, groupId, currentPage, pageSize, getAccessToken]);

    useEffect(() => {
        const run = async () => { await fetchSessions(); };
        void run();
    }, [fetchSessions]);

    const hasActive = sessions.some((session) => isRunActiveStatus(session.status));
    useEffect(() => {
        const onFocus = () => { void fetchSessions(); };
        window.addEventListener('focus', onFocus);
        const interval = hasActive ? setInterval(() => { void fetchSessions(); }, 5000) : null;
        return () => {
            window.removeEventListener('focus', onFocus);
            if (interval) clearInterval(interval);
        };
    }, [hasActive, fetchSessions]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const updateQuery = (updates: Record<string, string>) => {
        const next = new URLSearchParams(searchParams.toString());
        Object.entries(updates).forEach(([key, value]) => next.set(key, value));
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    };

    return (
        <main className="min-h-screen bg-gray-50">
            <div className="mx-auto max-w-7xl px-8 py-8">
                <Breadcrumbs items={[
                    { label: projectName, href: projectId ? `/projects/${projectId}?tab=test-groups` : undefined },
                    { label: groupName },
                ]} />

                <div className="mb-8 flex items-center gap-3">
                    <h1 className="text-3xl font-bold text-gray-900">{t('testGroup.history.title')}</h1>
                </div>

                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                    <div className="hidden grid-cols-12 items-center gap-4 border-b border-gray-200 bg-gray-50 p-4 text-sm font-medium text-gray-500 md:grid">
                        <div className="col-span-2">{t('history.table.status')}</div>
                        <div className="col-span-4">{t('history.table.date')}</div>
                        <div className="col-span-3">{t('history.table.runBy')}</div>
                        <div className="col-span-3 flex justify-end">{t('history.table.actions')}</div>
                    </div>

                    {!loaded ? (
                        <div className="divide-y divide-gray-100">
                            {Array.from({ length: 6 }, (_, index) => (
                                <div key={`session-skeleton-${index}`} className="grid grid-cols-1 items-center gap-4 p-4 md:grid-cols-12">
                                    <div className="md:col-span-2"><div className="skeleton-block h-6 w-20 rounded-full" /></div>
                                    <div className="md:col-span-4"><div className="skeleton-block h-4 w-40" /></div>
                                    <div className="md:col-span-3"><div className="skeleton-block h-4 w-32" /></div>
                                    <div className="flex justify-end md:col-span-3"><div className="skeleton-block h-4 w-16" /></div>
                                </div>
                            ))}
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="p-16 text-center">
                            <h3 className="mb-2 text-lg font-semibold text-gray-900">{t('testGroup.history.empty.title')}</h3>
                            <p className="text-gray-500">{t('testGroup.history.empty.subtitle')}</p>
                        </div>
                    ) : (
                        <>
                            <div className="divide-y divide-gray-100">
                                {sessions.map((session) => (
                                    <div key={session.id} className="grid grid-cols-1 items-center gap-4 p-4 transition-colors hover:bg-gray-50 md:grid-cols-12">
                                        <div className="md:col-span-2">
                                            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(session.status)}`}>
                                                {session.status}
                                            </span>
                                        </div>
                                        <div className="md:col-span-4">
                                            <div className="text-sm text-gray-700">{formatDateTime(session.createdAt)}</div>
                                            <div className="text-xs text-gray-400">{t('testGroup.caseCount', { count: session.memberCount })}</div>
                                        </div>
                                        <div className="truncate text-sm text-gray-500 md:col-span-3">
                                            {isSchedulerTriggered(session) ? t('run.trigger.scheduler') : (session.triggeredByEmail || '-')}
                                        </div>
                                        <div className="flex items-center justify-end md:col-span-3">
                                            <Link
                                                href={`/test-groups/runs/${session.id}?projectId=${projectId}`}
                                                className="inline-flex items-center rounded px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-blue-50 hover:text-primary/80"
                                            >
                                                {t('history.viewDetails')}
                                            </Link>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {total > 0 && (
                                <Pagination
                                    page={currentPage}
                                    limit={pageSize}
                                    total={total}
                                    totalPages={totalPages}
                                    onPageChange={(page) => updateQuery({ page: String(page) })}
                                    onLimitChange={(size) => updateQuery({ limit: String(size), page: '1' })}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>
        </main>
    );
}
