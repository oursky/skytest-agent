"use client";

import { useState, useEffect, use, useRef } from "react";
import { useAuth } from "../../../auth-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import Breadcrumbs from "@/components/Breadcrumbs";
import { formatDateTime } from "@/utils/dateFormatter";
import { useI18n } from "@/i18n";
import { getStatusBadgeClass } from '@/utils/statusBadge';
import Pagination from '@/components/Pagination';

interface TestRun {
    id: string;
    status: string;
    createdAt: string;
    result: string;
    error: string | null;
}

export default function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const { t } = useI18n();

    const [testRuns, setTestRuns] = useState<TestRun[]>([]);
    const [testCaseName, setTestCaseName] = useState<string>("");
    const [projectId, setProjectId] = useState<string>("");
    const [projectName, setProjectName] = useState<string>("");
    const [isLoading, setIsLoading] = useState(true);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; runId: string; status?: string }>({ isOpen: false, runId: "", status: "" });
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    const eventSourceRef = useRef<EventSource | null>(null);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

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
    }, [id, isLoggedIn, isAuthLoading]);

    useEffect(() => {
        if (!isLoggedIn || isAuthLoading) return;
        if (!projectId) return;

        let disposed = false;

        const closeEventSource = () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
        };

        const connect = async () => {
            closeEventSource();

            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

            const token = await getAccessToken();
            if (disposed) return;
            if (!token) return;

            const eventsUrl = new URL(`/api/projects/${projectId}/events`, window.location.origin);
            eventsUrl.searchParams.set('token', token);

            const es = new EventSource(eventsUrl.toString());
            eventSourceRef.current = es;

            es.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data) as {
                        type?: string;
                        testCaseId?: string;
                        runId?: string;
                        status?: string;
                    };

                    if (data.type !== 'test-run-status') return;
                    if (data.testCaseId !== id) return;

                    const runId = data.runId;
                    const status = data.status;
                    if (!runId || !status) return;

                    setTestRuns((current) => {
                        const next = current.map((run) => (run.id === runId ? { ...run, status } : run));
                        const found = next.some((run) => run.id === runId);
                        if (found) return next;

                        return [
                            {
                                id: runId,
                                status,
                                createdAt: new Date().toISOString(),
                                result: '',
                                error: null,
                            },
                            ...next,
                        ];
                    });
                } catch {
                    // ignore malformed events
                }
            };

            es.onerror = () => {
                if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                    closeEventSource();
                }
            };
        };

        void connect();

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void connect();
            } else {
                closeEventSource();
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            disposed = true;
            document.removeEventListener('visibilitychange', onVisibilityChange);
            closeEventSource();
        };
    }, [getAccessToken, id, isAuthLoading, isLoggedIn, projectId]);

    const fetchTestCaseInfo = async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};

            const response = await fetch(`/api/test-cases/${id}`, { headers });
            if (response.ok) {
                const data = await response.json();
                setTestCaseName(data.name);
                setProjectId(data.projectId);
                const projectResponse = await fetch(`/api/projects/${data.projectId}`, { headers });
                if (projectResponse.ok) {
                    const projectData = await projectResponse.json();
                    setProjectName(projectData.name);
                }
            }
        } catch (error) {
            console.error("Failed to fetch test case info", error);
        }
    };

    const fetchHistory = async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-cases/${id}/history?limit=100`, { headers });
            if (response.ok) {
                const result = await response.json();
                setTestRuns(result.data || result);
            }
        } catch (error) {
            console.error("Failed to fetch history", error);
        }
    };

    const handleDeleteRun = async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-runs/${deleteModal.runId}`, {
                method: "DELETE",
                headers
            });

            if (response.ok) {
                fetchHistory();
                setDeleteModal({ isOpen: false, runId: "", status: "" });
            }
        } catch (error) {
            console.error("Failed to delete test run", error);
        }
    };

    const totalPages = Math.ceil(testRuns.length / pageSize);
    const paginatedTestRuns = testRuns.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
    );

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
    };

    const handlePageSizeChange = (size: number) => {
        setPageSize(size);
        setCurrentPage(1);
    };

    if (isAuthLoading || isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    const isRunningOrQueued = ['RUNNING', 'QUEUED'].includes(deleteModal.status || '');

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
                            {paginatedTestRuns.map((run) => {
                                const isRunRunningOrQueued = ['RUNNING', 'QUEUED'].includes(run.status);
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
