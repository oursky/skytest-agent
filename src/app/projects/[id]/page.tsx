"use client";

import { useState, useEffect, use, useCallback, useRef } from "react";
import { useAuth } from "../../auth-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import Breadcrumbs from "@/components/Breadcrumbs";
import { formatDateTimeCompact } from "@/utils/dateFormatter";
import { useI18n } from "@/i18n";
import { getStatusBadgeClass } from '@/utils/statusBadge';
import Pagination from '@/components/Pagination';

interface TestRun {
    id: string;
    status: string;
    createdAt: string;
}

interface TestCase {
    id: string;
    displayId?: string;
    status?: string;
    name: string;
    url: string;
    prompt: string;
    steps: string | null;
    browserConfig: string | null;
    updatedAt: string;
    testRuns: TestRun[];
}

interface ProjectPageProps {
    params: Promise<{ id: string }>;
}

interface Project {
    id: string;
    name: string;
}

export default function ProjectPage({ params }: ProjectPageProps) {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const resolvedParams = use(params);
    const { id } = resolvedParams;
    const router = useRouter();
    const { t } = useI18n();

    const [project, setProject] = useState<Project | null>(null);
    const [testCases, setTestCases] = useState<TestCase[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; testCaseId: string; testCaseName: string }>({ isOpen: false, testCaseId: "", testCaseName: "" });
    const [sortColumn, setSortColumn] = useState<'id' | 'name' | 'status' | 'updated'>('updated');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    const refreshAbortRef = useRef<AbortController | null>(null);
    const eventSourceRef = useRef<EventSource | null>(null);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    const getAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
        const token = await getAccessToken();
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }, [getAccessToken]);

    const fetchProject = useCallback(async (signal?: AbortSignal) => {
        if (!resolvedParams.id) return;

        const headers = await getAuthHeaders();
        const projectRes = await fetch(`/api/projects/${resolvedParams.id}`, { headers, signal });

        if (!projectRes.ok) {
            if (projectRes.status === 404) throw new Error("Project not found");
            if (projectRes.status === 401) throw new Error("Unauthorized");
            throw new Error("Failed to fetch project data");
        }

        const projectData = await projectRes.json();
        setProject(projectData);
    }, [resolvedParams.id, getAuthHeaders]);

    const fetchTestCases = useCallback(async (signal?: AbortSignal) => {
        if (!resolvedParams.id) return;

        const headers = await getAuthHeaders();
        const testCasesRes = await fetch(`/api/projects/${resolvedParams.id}/test-cases`, { headers, signal });

        if (!testCasesRes.ok) {
            if (testCasesRes.status === 401) throw new Error("Unauthorized");
            throw new Error("Failed to fetch project data");
        }

        const testCasesData = await testCasesRes.json();
        setTestCases(testCasesData);
    }, [resolvedParams.id, getAuthHeaders]);

    const fetchData = useCallback(async (silent = false) => {
        if (!resolvedParams.id) return;

        try {
            if (!silent) setIsLoading(true);
            await Promise.all([fetchProject(), fetchTestCases()]);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to fetch project data";
            console.error("Error fetching project data:", message, err);
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [resolvedParams.id, fetchProject, fetchTestCases]);

    useEffect(() => {
        if (!isLoggedIn || isAuthLoading) return;
        if (!resolvedParams.id) return;

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

            const eventsUrl = new URL(`/api/projects/${resolvedParams.id}/events`, window.location.origin);
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

                    const testCaseId = data.testCaseId;
                    const runId = data.runId;
                    const status = data.status;
                    if (!testCaseId || !runId || !status) return;

                    setTestCases((current) =>
                        current.map((testCase) => {
                            if (testCase.id !== testCaseId) return testCase;

                            const latestRun = testCase.testRuns?.[0];
                            if (!latestRun || latestRun.id !== runId) {
                                return {
                                    ...testCase,
                                    testRuns: [
                                        {
                                            id: runId,
                                            status,
                                            createdAt: new Date().toISOString(),
                                        },
                                    ],
                                };
                            }

                            if (latestRun.status === status) return testCase;

                            return {
                                ...testCase,
                                testRuns: [{ ...latestRun, status }],
                            };
                        })
                    );
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

        const refreshTestCases = async () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

            refreshAbortRef.current?.abort();
            const controller = new AbortController();
            refreshAbortRef.current = controller;

            try {
                await fetchTestCases(controller.signal);
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') {
                    return;
                }
                console.error("Error fetching test cases:", err);
            }
        };

        fetchData();
        void connect();

        const onFocus = () => {
            fetchData(true);
            void connect();
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void connect();
                void refreshTestCases();
            } else {
                closeEventSource();
                refreshAbortRef.current?.abort();
            }
        };

        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);

        const refreshIntervalId = setInterval(refreshTestCases, 60000);

        return () => {
            disposed = true;
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            clearInterval(refreshIntervalId);
            closeEventSource();
            refreshAbortRef.current?.abort();
            refreshAbortRef.current = null;
        };
    }, [fetchData, fetchTestCases, getAccessToken, isLoggedIn, isAuthLoading, resolvedParams.id]);

    const handleDeleteTestCase = async () => {
        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/test-cases/${deleteModal.testCaseId}`, {
                method: "DELETE",
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });

            if (response.ok) {
                setTestCases(prev => prev.filter(tc => tc.id !== deleteModal.testCaseId));
                setDeleteModal({ isOpen: false, testCaseId: "", testCaseName: "" });
            }
        } catch (error) {
            console.error("Failed to delete test case", error);
        }
    };

    const handleCloneTestCase = async (testCaseId: string) => {
        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/test-cases/${testCaseId}/clone`, {
                method: "POST",
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });

            if (response.ok) {
                const clonedTestCase = await response.json();
                router.push(`/run?testCaseId=${clonedTestCase.id}&projectId=${id}`);
            }
        } catch (error) {
            console.error("Failed to clone test case", error);
        }
    };

    const handleSort = (column: 'id' | 'name' | 'status' | 'updated') => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    const handleSearch = () => {
        setSearchQuery(searchInput.trim());
        setCurrentPage(1);
    };

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    const filteredTestCases = testCases.filter((tc) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        const matchesId = tc.displayId?.toLowerCase().includes(query);
        const matchesName = tc.name.toLowerCase().includes(query);
        return matchesId || matchesName;
    });

    const sortedTestCases = [...filteredTestCases].sort((a, b) => {
        let comparison = 0;
        
        switch (sortColumn) {
            case 'id':
                const idA = a.displayId || '';
                const idB = b.displayId || '';
                comparison = idA.localeCompare(idB);
                break;
            case 'name':
                comparison = a.name.localeCompare(b.name);
                break;
            case 'status':
                const statusA = a.status || a.testRuns[0]?.status || '';
                const statusB = b.status || b.testRuns[0]?.status || '';
                comparison = statusA.localeCompare(statusB);
                break;
            case 'updated':
                comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
                break;
        }
        
        return sortDirection === 'asc' ? comparison : -comparison;
    });

    const totalPages = Math.ceil(sortedTestCases.length / pageSize);
    const paginatedTestCases = sortedTestCases.slice(
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

    const SortIcon = ({ column }: { column: 'id' | 'name' | 'status' | 'updated' }) => {
        if (sortColumn !== column) {
            return (
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
            );
        }
        return sortDirection === 'asc' ? (
            <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
        ) : (
            <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
        );
    };

    if (isAuthLoading || isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <Modal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, testCaseId: "", testCaseName: "" })}
                title={t('project.deleteTestCase.title')}
                onConfirm={handleDeleteTestCase}
                confirmText={t('project.deleteTestCase.confirm')}
                confirmVariant="danger"
            >
                <p className="text-gray-700">
                    {t('project.deleteTestCase.body', { name: deleteModal.testCaseName })}
                </p>
            </Modal>

            <div className="max-w-5xl mx-auto">
                <Breadcrumbs items={[{ label: project?.name || t('common.project') }]} />

                <div className="flex items-center justify-between mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">{t('project.testCases.title')}</h1>
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <input
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onKeyDown={handleSearchKeyDown}
                                placeholder={t('project.search.placeholder')}
                                className="pl-3 pr-10 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent w-64"
                            />
                            <button
                                onClick={handleSearch}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                                aria-label={t('project.search.button')}
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </button>
                        </div>
                        <Link
                            href={`/run?projectId=${id}`}
                            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            {t('project.startNewRun')}
                        </Link>
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="hidden md:grid grid-cols-12 gap-4 p-4 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-500">
                        <button
                            onClick={() => handleSort('id')}
                            className="col-span-2 flex items-center gap-1 hover:text-gray-700 transition-colors text-left"
                        >
                            {t('project.table.id')}
                            <SortIcon column="id" />
                        </button>
                        <button
                            onClick={() => handleSort('name')}
                            className="col-span-3 flex items-center gap-1 hover:text-gray-700 transition-colors text-left"
                        >
                            {t('project.table.name')}
                            <SortIcon column="name" />
                        </button>
                        <button
                            onClick={() => handleSort('status')}
                            className="col-span-2 flex items-center gap-1 hover:text-gray-700 transition-colors text-left"
                        >
                            {t('project.table.latestStatus')}
                            <SortIcon column="status" />
                        </button>
                        <button
                            onClick={() => handleSort('updated')}
                            className="col-span-2 flex items-center gap-1 hover:text-gray-700 transition-colors text-left"
                        >
                            {t('project.table.updated')}
                            <SortIcon column="updated" />
                        </button>
                        <div className="col-span-3 text-right">{t('project.table.actions')}</div>
                    </div>

                    {testCases.length === 0 ? (
                        <div className="p-16 text-center">
                            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('project.noTestCases.title')}</h3>
                            <p className="text-gray-500 mb-6">{t('project.noTestCases.subtitle')}</p>
                            <Link
                                href={`/run?projectId=${id}`}
                                className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                </svg>
                                {t('project.startNewRun')}
                            </Link>
                        </div>
                    ) : (
                        <>
                        <div className="divide-y divide-gray-100">
                            {paginatedTestCases.map((testCase) => {
                                const currentStatus = testCase.status || (testCase.testRuns[0]?.status);

                                return (
                                    <div key={testCase.id} className="flex flex-col md:grid md:grid-cols-12 gap-4 p-4 hover:bg-gray-50 transition-colors group">
                                        <div className="md:col-span-2 flex items-center">
                                            {testCase.displayId ? (
                                                <span className="text-xs text-gray-500 font-mono">{testCase.displayId}</span>
                                            ) : (
                                                <span className="text-gray-400 text-sm">-</span>
                                            )}
                                        </div>
                                        <div className="md:col-span-3 flex items-center">
                                            <Link
                                                href={`/run?testCaseId=${testCase.id}&projectId=${id}`}
                                                className="font-medium text-gray-900 hover:text-primary transition-colors"
                                            >
                                                {testCase.name}
                                            </Link>
                                        </div>
                                        <div className="flex items-center gap-4 md:contents">
                                            <div className="md:col-span-2 flex items-center">
                                                {currentStatus ? (
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusBadgeClass(currentStatus)}`}>
                                                        {currentStatus}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 text-sm">-</span>
                                                )}
                                            </div>
                                            <div className="md:col-span-2 text-sm text-gray-500 flex items-center">
                                                {formatDateTimeCompact(testCase.updatedAt)}
                                            </div>
                                            <div className="md:col-span-3 flex justify-end gap-2">
                                                {(!testCase.testRuns[0] || !['RUNNING', 'QUEUED'].includes(testCase.testRuns[0].status)) && (
                                                    <Link
                                                        href={`/run?testCaseId=${testCase.id}&name=${encodeURIComponent(testCase.name)}`}
                                                        className="p-2 text-gray-500 hover:text-primary hover:bg-primary/10 rounded-md transition-colors inline-flex items-center justify-center"
                                                        title={t('project.tooltip.run')}
                                                        aria-label={t('project.tooltip.run')}
                                                    >
                                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                        </svg>
                                                    </Link>
                                                )}
                                                {testCase.testRuns[0] && ['RUNNING', 'QUEUED'].includes(testCase.testRuns[0].status) && (
                                                    <Link
                                                        href={`/run?runId=${testCase.testRuns[0].id}&testCaseId=${testCase.id}`}
                                                        className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors inline-flex items-center justify-center animate-pulse"
                                                        title={t('project.tooltip.viewRunning')}
                                                        aria-label={t('project.tooltip.viewRunning')}
                                                    >
                                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                        </svg>
                                                    </Link>
                                                )}
                                                <Link
                                                    href={`/test-cases/${testCase.id}/history`}
                                                    className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors inline-flex items-center justify-center"
                                                    title={t('project.tooltip.viewHistory')}
                                                    aria-label={t('project.tooltip.viewHistory')}
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                </Link>
                                                <button
                                                    onClick={() => handleCloneTestCase(testCase.id)}
                                                    className="p-2 text-gray-500 hover:text-primary hover:bg-primary/10 rounded-md transition-colors inline-flex items-center justify-center"
                                                    title={t('project.tooltip.clone')}
                                                    aria-label={t('project.tooltip.clone')}
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                    </svg>
                                                </button>
                                                <button
                                                    onClick={() => setDeleteModal({ isOpen: true, testCaseId: testCase.id, testCaseName: testCase.name })}
                                                    disabled={testCase.testRuns[0] && ['RUNNING', 'QUEUED'].includes(testCase.testRuns[0].status)}
                                                    className={`p-2 rounded-md transition-colors inline-flex items-center justify-center ${testCase.testRuns[0] && ['RUNNING', 'QUEUED'].includes(testCase.testRuns[0].status)
                                                        ? 'text-gray-300 cursor-not-allowed'
                                                        : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                                                        }`}
                                                    title={testCase.testRuns[0] && ['RUNNING', 'QUEUED'].includes(testCase.testRuns[0].status)
                                                        ? t('project.tooltip.cannotDeleteRunning')
                                                        : t('project.tooltip.delete')}
                                                    aria-label={t('project.tooltip.delete')}
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <Pagination
                            page={currentPage}
                            limit={pageSize}
                            total={sortedTestCases.length}
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
