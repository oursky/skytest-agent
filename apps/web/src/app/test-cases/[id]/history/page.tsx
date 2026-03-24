"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useAuth } from "../../../auth-provider";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CenteredLoading, Modal, Pagination } from "@/components/shared";
import { Breadcrumbs } from "@/components/layout";
import { formatDateTime } from "@/utils/time/dateFormatter";
import { useI18n } from "@/i18n";
import { getStatusBadgeClass } from '@/utils/status/statusBadge';
import { parsePageSize } from '@/utils/pagination/pagination';
import { isRunActiveStatus, type TestStatus } from '@/types';

interface TestRun {
    id: string;
    status: TestStatus;
    createdAt: string;
    result: string;
    error: string | null;
}

interface HistoryResponse {
    data: TestRun[];
    pagination?: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export default function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const pageSize = parsePageSize(searchParams.get('limit'));
    const { t } = useI18n();

    const [testRuns, setTestRuns] = useState<TestRun[]>([]);
    const [totalRuns, setTotalRuns] = useState(0);
    const [testCaseName, setTestCaseName] = useState<string>("");
    const [projectId, setProjectId] = useState<string>("");
    const [projectName, setProjectName] = useState<string>("");
    const [isLoading, setIsLoading] = useState(true);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; runId: string; status?: TestStatus | '' }>({ isOpen: false, runId: "", status: "" });
    const parsedPage = Number.parseInt(searchParams.get('page') || '1', 10);
    const currentPage = Number.isNaN(parsedPage) ? 1 : Math.max(1, parsedPage);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    const fetchTestCaseInfo = useCallback(async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};

            const response = await fetch(`/api/test-cases/${id}`, { headers });
            if (response.ok) {
                const data = await response.json();
                setTestCaseName(data.name);
                setProjectId(data.projectId);
                setProjectName(typeof data.projectName === 'string' ? data.projectName : '');
            }
        } catch (error) {
            console.error("Failed to fetch test case info", error);
        }
    }, [getAccessToken, id]);

    const fetchHistory = useCallback(async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const historyParams = new URLSearchParams({
                page: String(currentPage),
                limit: String(pageSize),
            });
            const response = await fetch(`/api/test-cases/${id}/history?${historyParams.toString()}`, { headers });
            if (response.ok) {
                const result = await response.json() as HistoryResponse;
                const runs = Array.isArray(result.data) ? result.data : [];
                setTestRuns(runs);
                setTotalRuns(result.pagination?.total ?? runs.length);
            }
        } catch (error) {
            console.error("Failed to fetch history", error);
        }
    }, [currentPage, getAccessToken, id, pageSize]);

    useEffect(() => {
        const loadData = async () => {
            if (!isLoggedIn || isAuthLoading) return;
            setIsLoading(true);
            try {
                await Promise.all([fetchHistory(), fetchTestCaseInfo()]);
            } catch (error) {
                console.error("Error loading data:", error);
            } finally {
                setIsLoading(false);
            }
        };

        if (id) {
            loadData();
        }
    }, [fetchHistory, fetchTestCaseInfo, id, isLoggedIn, isAuthLoading]);

    useEffect(() => {
        if (!isLoggedIn || isAuthLoading) return;
        if (!projectId) return;

        const refreshHistory = () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                return;
            }
            void fetchHistory();
        };
        const onFocus = () => refreshHistory();
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                refreshHistory();
            }
        };

        const shouldPoll = testRuns.some((run) => isRunActiveStatus(run.status));
        if (!shouldPoll) {
            return;
        }

        const interval = setInterval(refreshHistory, 30000);

        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [fetchHistory, isAuthLoading, isLoggedIn, projectId, testRuns]);

    const handleDeleteRun = async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-runs/${deleteModal.runId}`, {
                method: "DELETE",
                headers
            });

            if (response.ok) {
                void fetchHistory();
                setDeleteModal({ isOpen: false, runId: "", status: "" });
            }
        } catch (error) {
            console.error("Failed to delete test run", error);
        }
    };

    const totalPages = Math.max(1, Math.ceil(totalRuns / pageSize));

    const handlePageChange = (page: number) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('page', String(page));
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    const handlePageSizeChange = (size: number) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('limit', String(size));
        params.set('page', '1');
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    if (isAuthLoading || isLoading) {
        return <CenteredLoading className="min-h-screen" />;
    }

    const isRunningOrQueued = isRunActiveStatus(deleteModal.status);

    return (
        <main className="min-h-screen bg-gray-50">
            <Modal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, runId: "", status: "" })}
                title={isRunningOrQueued ? t('history.modal.delete.titleRunning') : t('history.modal.delete.title')}
                onConfirm={handleDeleteRun}
                confirmText={isRunningOrQueued ? t('history.modal.delete.confirmRunning') : t('history.modal.delete.confirm')}
                confirmVariant="danger"
            >
                <div className="text-gray-700">
                    {isRunningOrQueued ? (
                        <div className="space-y-2">
                            <p className="font-semibold text-red-600">{t('history.modal.runningWarningTitle')}</p>
                            <p>{t('history.modal.runningWarningBody')}</p>
                        </div>
                    ) : (
                        <p>{t('history.modal.delete.body')}</p>
                    )}
                </div>
            </Modal>

            <div className="max-w-7xl mx-auto px-8 py-8">
                <Breadcrumbs items={[
                    { label: projectName, href: projectId ? `/projects/${projectId}` : undefined },
                    { label: testCaseName }
                ]} />

                <h1 className="text-3xl font-bold text-gray-900 mb-8">{t('history.title')}</h1>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="grid grid-cols-12 gap-4 p-4 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-500 items-center">
                        <div className="col-span-3">{t('history.table.status')}</div>
                        <div className="col-span-5">{t('history.table.date')}</div>
                        <div className="col-span-4 flex justify-end">{t('history.table.actions')}</div>
                    </div>

                    {testRuns.length === 0 ? (
                        <div className="p-16 text-center">
                            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('history.noHistory.title')}</h3>
                            <p className="text-gray-500">{t('history.noHistory.subtitle')}</p>
                        </div>
                    ) : (
                        <>
                        <div className="divide-y divide-gray-100">
                            {testRuns.map((run) => {
                                const isRunRunningOrQueued = isRunActiveStatus(run.status);
                                return (
                                    <div key={run.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-gray-50 transition-colors">
                                        <div className="col-span-3">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusBadgeClass(run.status)}`}>
                                                {run.status}
                                            </span>
                                        </div>
                                        <div className="col-span-5 text-sm text-gray-500">
                                            {formatDateTime(run.createdAt)}
                                        </div>
                                        <div className="col-span-4 flex items-center justify-end gap-2">
                                            {isRunRunningOrQueued ? (
                                                <Link
                                                    href={`/run?runId=${run.id}&testCaseId=${id}`}
                                                    className="px-3 py-1.5 text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 text-sm font-medium rounded transition-colors flex items-center gap-1 animate-pulse whitespace-nowrap w-fit"
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                    </svg>
                                                    {t('history.viewLive')}
                                                </Link>
                                            ) : (
                                                <Link
                                                    href={`/test-cases/${id}/history/${run.id}`}
                                                    className="px-3 py-1.5 text-primary hover:text-primary/80 text-sm font-medium hover:bg-blue-50 rounded transition-colors inline-flex items-center whitespace-nowrap w-fit"
                                                >
                                                    {t('history.viewDetails')}
                                                </Link>
                                            )}
                                            <button
                                                onClick={() => setDeleteModal({ isOpen: true, runId: run.id, status: run.status })}
                                                disabled={isRunRunningOrQueued}
                                                className={`p-2 transition-colors shrink-0 ${isRunRunningOrQueued
                                                    ? 'text-gray-300 cursor-not-allowed'
                                                    : 'text-gray-400 hover:text-red-600'
                                                    }`}
                                                title={isRunRunningOrQueued ? t('history.cannotDeleteRunning') : t('history.deleteRun')}
                                                aria-label={t('history.deleteRun')}
                                            >
                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <Pagination
                            page={currentPage}
                            limit={pageSize}
                            total={testRuns.length}
                            totalPages={totalPages}
                            onPageChange={handlePageChange}
                            onLimitChange={handlePageSizeChange}
                        />
                        </>
                    )}
                </div>
            </div>
        </main>
    );
}
