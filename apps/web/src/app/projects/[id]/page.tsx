"use client";

import { useState, useEffect, use, useCallback, useRef } from "react";
import { useAuth } from "../../auth-provider";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CenteredLoading, Modal, Pagination, UnderlineTabs } from "@/components/shared";
import { Breadcrumbs } from "@/components/layout";
import { formatDateTimeCompact } from "@/utils/time/dateFormatter";
import { useI18n } from "@/i18n";
import { getStatusBadgeClass } from '@/utils/status/statusBadge';
import { isActiveRunStatus } from '@/utils/status/statusHelpers';
import { parsePageSize } from '@/utils/pagination/pagination';
import { ProjectConfigs } from '@/components/features/project-configurations';
import ProjectSettingsPanel from '@/components/features/projects/ui/ProjectSettingsPanel';
import TestCaseImportReviewDialog, {
    type TestCaseImportReviewData,
} from '@/components/features/test-cases/ui/TestCaseImportReviewDialog';
import ProjectTestCasesToolbar from '@/components/features/test-cases/ui/ProjectTestCasesToolbar';

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
    updatedAt: string;
    testRuns: TestRun[];
}

interface ProjectPageProps {
    params: Promise<{ id: string }>;
}

interface Project {
    id: string;
    name: string;
    maxConcurrentRuns: number;
    maxConcurrentRunsLimit?: number;
    canManageProject?: boolean;
}

interface BatchImportResponse extends TestCaseImportReviewData {
    mode: 'validate' | 'import-valid';
}

type ProjectTab = 'test-cases' | 'variables' | 'settings';

function extractFilenameFromContentDisposition(headerValue: string | null, fallbackName: string): string {
    if (!headerValue) {
        return fallbackName;
    }
    const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
        try {
            return decodeURIComponent(utf8Match[1].replace(/["']/g, '').trim());
        } catch {
            return utf8Match[1].replace(/["']/g, '').trim();
        }
    }
    const asciiMatch = headerValue.match(/filename="?([^";]+)"?/i);
    if (!asciiMatch?.[1]) {
        return fallbackName;
    }
    return asciiMatch[1].trim();
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

export default function ProjectPage({ params }: ProjectPageProps) {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const resolvedParams = use(params);
    const { id } = resolvedParams;
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const pageSize = parsePageSize(searchParams.get('limit'));
    const { t } = useI18n();

    const [project, setProject] = useState<Project | null>(null);
    const [testCases, setTestCases] = useState<TestCase[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; testCaseId: string; testCaseName: string }>({ isOpen: false, testCaseId: "", testCaseName: "" });
    const [sortColumn, setSortColumn] = useState<'id' | 'name' | 'status' | 'updated'>('id');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [currentPage, setCurrentPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<ProjectTab>('test-cases');
    const [maxConcurrentRunsInput, setMaxConcurrentRunsInput] = useState('1');
    const [settingsError, setSettingsError] = useState('');
    const [isEditingProjectSettings, setIsEditingProjectSettings] = useState(false);
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    const [editingDisplayIdTestCaseId, setEditingDisplayIdTestCaseId] = useState<string | null>(null);
    const [editingDisplayIdValue, setEditingDisplayIdValue] = useState('');
    const [savingDisplayIdTestCaseId, setSavingDisplayIdTestCaseId] = useState<string | null>(null);
    const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<Set<string>>(new Set());
    const [isExportingSelected, setIsExportingSelected] = useState(false);
    const [isBatchImportProcessing, setIsBatchImportProcessing] = useState(false);
    const [batchImportReviewData, setBatchImportReviewData] = useState<BatchImportResponse | null>(null);
    const [pendingBatchImportFiles, setPendingBatchImportFiles] = useState<File[]>([]);
    const displayIdInputRef = useRef<HTMLInputElement | null>(null);
    const batchImportInputRef = useRef<HTMLInputElement | null>(null);
    const skipBlurSaveRef = useRef(false);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        const tab = searchParams.get('tab');
        if (tab === 'variables') { setActiveTab('variables'); return; }
        if (tab === 'settings') { setActiveTab('settings'); return; }
        if (tab === 'test-cases') { setActiveTab('test-cases'); }
    }, [searchParams]);

    useEffect(() => {
        if (editingDisplayIdTestCaseId) {
            displayIdInputRef.current?.focus();
            displayIdInputRef.current?.select();
        }
    }, [editingDisplayIdTestCaseId]);

    useEffect(() => {
        const validIds = new Set(testCases.map((item) => item.id));
        setSelectedTestCaseIds((prev) => {
            const next = new Set<string>();
            prev.forEach((idValue) => {
                if (validIds.has(idValue)) {
                    next.add(idValue);
                }
            });
            return next;
        });
    }, [testCases]);

    const handleTabChange = useCallback((tab: ProjectTab) => {
        setActiveTab(tab);

        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', tab);
        const query = params.toString();

        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [pathname, router, searchParams]);

    const getAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
        const token = await getAccessToken();
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }, [getAccessToken]);

    const fetchProject = useCallback(async (signal?: AbortSignal) => {
        if (!resolvedParams.id) return;

        const headers = await getAuthHeaders();
        const projectRes = await fetch(`/api/projects/${resolvedParams.id}`, { headers, signal });

        if (!projectRes.ok) {
            if (projectRes.status === 404) {
                const notFoundError = new Error("Project not found");
                notFoundError.name = "ProjectNotFoundError";
                throw notFoundError;
            }
            if (projectRes.status === 401) {
                const unauthorizedError = new Error("Unauthorized");
                unauthorizedError.name = "UnauthorizedError";
                throw unauthorizedError;
            }
            throw new Error("Failed to fetch project data");
        }

        const projectData = await projectRes.json() as Project;
        setProject(projectData);
        setMaxConcurrentRunsInput(String(projectData.maxConcurrentRuns));
        setSettingsError('');
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
        let keepLoading = false;

        try {
            if (!silent) setIsLoading(true);
            await Promise.all([fetchProject(), fetchTestCases()]);
        } catch (err: unknown) {
            if (err instanceof Error) {
                if (err.name === "ProjectNotFoundError") {
                    keepLoading = true;
                    setProject(null);
                    setTestCases([]);
                    router.replace("/projects");
                    return;
                }

                if (err.name === "UnauthorizedError") {
                    keepLoading = true;
                    router.replace("/");
                    return;
                }

                if (err.name === "AbortError") {
                    return;
                }
            }

            const message = err instanceof Error ? err.message : "Failed to fetch project data";
            console.error("Error fetching project data:", message, err);
        } finally {
            if (!silent && !keepLoading) setIsLoading(false);
        }
    }, [resolvedParams.id, fetchProject, fetchTestCases, router]);

    const hasActiveRuns = testCases.some((testCase) => (
        testCase.testRuns.some((run) => isActiveRunStatus(run.status))
    ));

    useEffect(() => {
        if (!isLoggedIn || isAuthLoading) return;
        if (!resolvedParams.id) return;

        const refreshTestCases = async () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

            try {
                await fetchTestCases();
            } catch (err) {
                console.error("Error fetching test cases:", err);
            }
        };

        fetchData();
        const onFocus = () => {
            void fetchData(true);
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void refreshTestCases();
            }
        };

        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [fetchData, fetchTestCases, isLoggedIn, isAuthLoading, resolvedParams.id]);

    useEffect(() => {
        if (!isLoggedIn || isAuthLoading) return;
        if (!resolvedParams.id || !hasActiveRuns) return;

        const refreshTestCases = async () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

            try {
                await fetchTestCases();
            } catch (err) {
                console.error("Error fetching test cases:", err);
            }
        };

        const refreshIntervalId = setInterval(refreshTestCases, 60000);
        return () => {
            clearInterval(refreshIntervalId);
        };
    }, [fetchTestCases, hasActiveRuns, isLoggedIn, isAuthLoading, resolvedParams.id]);

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

    const handleSaveProjectSettings = useCallback(async () => {
        if (!project) {
            return;
        }

        const parsedValue = Number.parseInt(maxConcurrentRunsInput, 10);
        const maxLimit = project.maxConcurrentRunsLimit ?? 5;

        if (!Number.isInteger(parsedValue)) {
            setSettingsError(t('project.settings.error.invalidInteger'));
            return;
        }
        if (parsedValue < 1 || parsedValue > maxLimit) {
            setSettingsError(t('project.settings.error.outOfRange', { max: maxLimit }));
            return;
        }
        if (parsedValue === project.maxConcurrentRuns) {
            setSettingsError('');
            setIsEditingProjectSettings(false);
            return;
        }

        try {
            setIsSavingSettings(true);
            setSettingsError('');

            const token = await getAccessToken();
            const response = await fetch(`/api/projects/${project.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    maxConcurrentRuns: parsedValue,
                }),
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({ error: t('project.settings.error.save') }));
                setSettingsError(typeof data.error === 'string' ? data.error : t('project.settings.error.save'));
                return;
            }

            const updatedProject = await response.json() as Project;
            setProject(updatedProject);
            setMaxConcurrentRunsInput(String(updatedProject.maxConcurrentRuns));
            setIsEditingProjectSettings(false);
            await fetchProject();
        } catch (error) {
            console.error('Failed to update project settings', error);
            setSettingsError(t('project.settings.error.save'));
        } finally {
            setIsSavingSettings(false);
        }
    }, [fetchProject, getAccessToken, maxConcurrentRunsInput, project, t]);

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

    const startDisplayIdEdit = (testCase: TestCase) => {
        setEditingDisplayIdTestCaseId(testCase.id);
        setEditingDisplayIdValue(testCase.displayId || '');
    };

    const clearDisplayIdEditState = useCallback(() => {
        setEditingDisplayIdTestCaseId(null);
        setEditingDisplayIdValue('');
        setSavingDisplayIdTestCaseId(null);
    }, []);

    const saveDisplayId = useCallback(async (testCase: TestCase) => {
        const normalizedDisplayId = editingDisplayIdValue.trim();
        const existingDisplayId = (testCase.displayId || '').trim();

        if (!normalizedDisplayId || normalizedDisplayId === existingDisplayId) {
            clearDisplayIdEditState();
            return;
        }

        try {
            setSavingDisplayIdTestCaseId(testCase.id);
            const token = await getAccessToken();
            const response = await fetch(`/api/test-cases/${testCase.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    displayId: normalizedDisplayId,
                    preserveStatus: true
                }),
            });

            if (!response.ok) {
                throw new Error(`Failed to update test case ID (${response.status})`);
            }

            const updatedTestCase = await response.json() as { displayId?: string; updatedAt?: string };
            setTestCases((prev) => prev.map((item) => {
                if (item.id !== testCase.id) {
                    return item;
                }

                return {
                    ...item,
                    displayId: updatedTestCase.displayId ?? normalizedDisplayId,
                    updatedAt: typeof updatedTestCase.updatedAt === 'string' ? updatedTestCase.updatedAt : item.updatedAt,
                };
            }));
        } catch (error) {
            console.error('Failed to update test case ID', error);
        } finally {
            clearDisplayIdEditState();
        }
    }, [clearDisplayIdEditState, editingDisplayIdValue, getAccessToken]);

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
                const statusA = a.testRuns[0]?.status || a.status || '';
                const statusB = b.testRuns[0]?.status || b.status || '';
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
        setCurrentPage(1);
        const params = new URLSearchParams(searchParams.toString());
        params.set('limit', String(size));
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    const selectedCount = selectedTestCaseIds.size;
    const allFilteredSelected = sortedTestCases.length > 0
        && sortedTestCases.every((testCase) => selectedTestCaseIds.has(testCase.id));

    const handleToggleSelectAllFiltered = () => {
        setSelectedTestCaseIds((prev) => {
            const next = new Set(prev);
            if (allFilteredSelected) {
                sortedTestCases.forEach((testCase) => next.delete(testCase.id));
            } else {
                sortedTestCases.forEach((testCase) => next.add(testCase.id));
            }
            return next;
        });
    };

    const handleToggleSelectTestCase = (testCaseId: string) => {
        setSelectedTestCaseIds((prev) => {
            const next = new Set(prev);
            if (next.has(testCaseId)) {
                next.delete(testCaseId);
            } else {
                next.add(testCaseId);
            }
            return next;
        });
    };

    const runBatchImportRequest = useCallback(async (
        files: File[],
        mode: 'validate' | 'import-valid'
    ): Promise<BatchImportResponse | null> => {
        const token = await getAccessToken();
        const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
        const formData = new FormData();
        formData.append('mode', mode);
        files.forEach((file) => formData.append('files', file));
        const response = await fetch(`/api/projects/${id}/test-cases/batch-import`, {
            method: 'POST',
            headers,
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`Batch import request failed (${response.status})`);
        }
        return await response.json() as BatchImportResponse;
    }, [getAccessToken, id]);

    const handleBatchImportSelectedFiles = useCallback(async (files: File[]) => {
        if (files.length === 0) {
            return;
        }

        setIsBatchImportProcessing(true);
        try {
            const validationResult = await runBatchImportRequest(files, 'validate');
            if (!validationResult) {
                return;
            }

            const hasErrors = validationResult.files.some((file) => file.issues.some((issue) => issue.severity === 'error'));
            const hasWarnings = validationResult.files.some((file) => file.issues.some((issue) => issue.severity === 'warning'));

            if (!hasErrors && !hasWarnings) {
                await runBatchImportRequest(files, 'import-valid');
                await fetchTestCases();
                setBatchImportReviewData(null);
                setPendingBatchImportFiles([]);
                return;
            }

            setBatchImportReviewData(validationResult);
            setPendingBatchImportFiles(files);
        } catch (error) {
            console.error('Failed to validate batch import', error);
        } finally {
            setIsBatchImportProcessing(false);
        }
    }, [fetchTestCases, runBatchImportRequest]);

    const handleBatchImportInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []).filter((file) => file.name.toLowerCase().endsWith('.xlsx'));
        await handleBatchImportSelectedFiles(files);
        event.target.value = '';
    };

    const handleProceedBatchImport = async () => {
        if (pendingBatchImportFiles.length === 0) {
            setBatchImportReviewData(null);
            return;
        }
        setIsBatchImportProcessing(true);
        try {
            await runBatchImportRequest(pendingBatchImportFiles, 'import-valid');
            await fetchTestCases();
            setBatchImportReviewData(null);
            setPendingBatchImportFiles([]);
        } catch (error) {
            console.error('Failed to import valid batch records', error);
        } finally {
            setIsBatchImportProcessing(false);
        }
    };

    const handleDiscardBatchImport = () => {
        setBatchImportReviewData(null);
        setPendingBatchImportFiles([]);
    };

    const handleExportSelected = async () => {
        if (selectedTestCaseIds.size === 0 || isExportingSelected) {
            return;
        }

        setIsExportingSelected(true);
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            };
            const response = await fetch(`/api/projects/${id}/test-cases/export`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ testCaseIds: Array.from(selectedTestCaseIds) }),
            });

            if (!response.ok) {
                throw new Error(`Export request failed (${response.status})`);
            }

            const blob = await response.blob();
            const filename = extractFilenameFromContentDisposition(
                response.headers.get('Content-Disposition'),
                `${project?.name || 'project'}_selected_test_cases.zip`
            );
            downloadBlob(blob, filename);
        } catch (error) {
            console.error('Failed to export selected test cases', error);
        } finally {
            setIsExportingSelected(false);
        }
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
        return <CenteredLoading className="min-h-screen" />;
    }

    const handleStartProjectSettingsEdit = () => {
        if (!project?.canManageProject) {
            return;
        }

        setMaxConcurrentRunsInput(String(project.maxConcurrentRuns));
        setSettingsError('');
        setIsEditingProjectSettings(true);
    };

    const handleCancelProjectSettingsEdit = () => {
        if (project) {
            setMaxConcurrentRunsInput(String(project.maxConcurrentRuns));
        }
        setSettingsError('');
        setIsEditingProjectSettings(false);
    };

    const isProjectSettingsSaveDisabled = isSavingSettings
        || !isEditingProjectSettings
        || !project?.canManageProject;
    const projectTabs = [
        { id: 'test-cases' as const, label: t('project.tab.testCases') },
        { id: 'variables' as const, label: t('project.tab.configs') },
        { id: 'settings' as const, label: t('project.tab.settings') },
    ];

    return (
        <main className="min-h-screen bg-gray-50">
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
            <TestCaseImportReviewDialog
                isOpen={batchImportReviewData !== null}
                data={batchImportReviewData}
                isProcessing={isBatchImportProcessing}
                onProceed={handleProceedBatchImport}
                onDiscard={handleDiscardBatchImport}
            />
            <input
                ref={batchImportInputRef}
                type="file"
                multiple
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleBatchImportInputChange}
            />

            <div className="max-w-7xl mx-auto px-8 py-8">
                <Breadcrumbs items={[{ label: project?.name || t('common.project') }]} />

                <h1 className="text-3xl font-bold text-gray-900 mb-4">{project?.name || t('common.project')}</h1>

                <div className="mb-6">
                    <UnderlineTabs
                        tabs={projectTabs}
                        activeTab={activeTab}
                        onChange={handleTabChange}
                    />
                </div>

                {activeTab === 'test-cases' && (
                    <ProjectTestCasesToolbar
                        projectId={id}
                        searchInput={searchInput}
                        onSearchInputChange={setSearchInput}
                        onSearchKeyDown={handleSearchKeyDown}
                        onSearch={handleSearch}
                        onOpenBatchImport={() => batchImportInputRef.current?.click()}
                        onExportSelected={handleExportSelected}
                        isBatchImportProcessing={isBatchImportProcessing}
                        isExportingSelected={isExportingSelected}
                        selectedCount={selectedCount}
                        t={t}
                    />
                )}

                {activeTab === 'variables' && (
                    <ProjectConfigs projectId={id} />
                )}

                {activeTab === 'settings' && project && (
                    <ProjectSettingsPanel
                        canManageProject={Boolean(project.canManageProject)}
                        maxConcurrentRunsLimit={project.maxConcurrentRunsLimit}
                        maxConcurrentRunsInput={maxConcurrentRunsInput}
                        isEditing={isEditingProjectSettings}
                        isSaving={isSavingSettings}
                        isSaveDisabled={isProjectSettingsSaveDisabled}
                        settingsError={settingsError}
                        onInputChange={(value) => {
                            setMaxConcurrentRunsInput(value);
                            setSettingsError('');
                        }}
                        onEnterSave={() => {
                            void handleSaveProjectSettings();
                        }}
                        onSave={() => {
                            void handleSaveProjectSettings();
                        }}
                        onCancel={handleCancelProjectSettingsEdit}
                        onStartEdit={handleStartProjectSettingsEdit}
                        t={t}
                    />
                )}

                <div className={`bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden ${activeTab !== 'test-cases' ? 'hidden' : ''}`}>
                    <div className="hidden md:grid grid-cols-24 gap-4 p-4 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-500">
                        <div className="col-span-1 flex items-center">
                            <input
                                type="checkbox"
                                checked={allFilteredSelected}
                                onChange={handleToggleSelectAllFiltered}
                                aria-label={t('project.table.selectAll')}
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            />
                        </div>
                        <button
                            onClick={() => handleSort('id')}
                            className="col-span-3 flex items-center gap-1 hover:text-gray-700 transition-colors text-left"
                        >
                            {t('project.table.id')}
                            <SortIcon column="id" />
                        </button>
                        <button
                            onClick={() => handleSort('name')}
                            className="col-span-8 flex items-center gap-1 hover:text-gray-700 transition-colors text-left"
                        >
                            {t('project.table.name')}
                            <SortIcon column="name" />
                        </button>
                        <button
                            onClick={() => handleSort('status')}
                            className="col-span-3 flex items-center gap-1 hover:text-gray-700 transition-colors text-left"
                        >
                            {t('project.table.status')}
                            <SortIcon column="status" />
                        </button>
                        <button
                            onClick={() => handleSort('updated')}
                            className="col-span-4 flex items-center gap-1 hover:text-gray-700 transition-colors text-left"
                        >
                            {t('project.table.updated')}
                            <SortIcon column="updated" />
                        </button>
                        <div className="col-span-5 text-right">{t('project.table.actions')}</div>
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
                                const latestRunStatus = testCase.testRuns[0]?.status;
                                const currentStatus = latestRunStatus && isActiveRunStatus(latestRunStatus)
                                    ? latestRunStatus
                                    : testCase.status;
                                const isEditingDisplayId = editingDisplayIdTestCaseId === testCase.id;
                                const isSavingDisplayId = savingDisplayIdTestCaseId === testCase.id;

                                return (
                                    <div key={testCase.id} className="flex flex-col md:grid md:grid-cols-24 gap-4 p-4 hover:bg-gray-50 transition-colors group">
                                        <div className="md:col-span-1 flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={selectedTestCaseIds.has(testCase.id)}
                                                onChange={() => handleToggleSelectTestCase(testCase.id)}
                                                aria-label={t('project.table.selectOne', { name: testCase.name })}
                                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                            />
                                        </div>
                                        <div className="md:col-span-3 flex items-center">
                                            {isEditingDisplayId ? (
                                                <input
                                                    ref={displayIdInputRef}
                                                    type="text"
                                                    value={editingDisplayIdValue}
                                                    onChange={(event) => setEditingDisplayIdValue(event.target.value)}
                                                    onBlur={() => {
                                                        if (skipBlurSaveRef.current) {
                                                            skipBlurSaveRef.current = false;
                                                            clearDisplayIdEditState();
                                                            return;
                                                        }

                                                        void saveDisplayId(testCase);
                                                    }}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter') {
                                                            event.currentTarget.blur();
                                                        }

                                                        if (event.key === 'Escape') {
                                                            skipBlurSaveRef.current = true;
                                                            event.currentTarget.blur();
                                                        }
                                                    }}
                                                    className="w-full rounded-md border border-primary/40 bg-white px-2 py-1 text-xs font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/40"
                                                    aria-label={t('project.table.id')}
                                                />
                                            ) : testCase.displayId ? (
                                                <button
                                                    type="button"
                                                    onClick={() => startDisplayIdEdit(testCase)}
                                                    disabled={isSavingDisplayId}
                                                    className="text-xs text-gray-500 font-mono hover:text-primary transition-colors disabled:opacity-60"
                                                >
                                                    {testCase.displayId}
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => startDisplayIdEdit(testCase)}
                                                    disabled={isSavingDisplayId}
                                                    className="text-gray-400 text-sm hover:text-primary transition-colors disabled:opacity-60"
                                                >
                                                    -
                                                </button>
                                            )}
                                        </div>
                                        <div className="md:col-span-8 flex items-center">
                                            <Link
                                                href={`/run?testCaseId=${testCase.id}&projectId=${id}`}
                                                className="font-medium text-gray-900 hover:text-primary transition-colors"
                                            >
                                                {testCase.name}
                                            </Link>
                                        </div>
                                        <div className="flex items-center gap-4 md:contents">
                                            <div className="md:col-span-3 flex items-center">
                                                {currentStatus ? (
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusBadgeClass(currentStatus)}`}>
                                                        {currentStatus}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 text-sm">-</span>
                                                )}
                                            </div>
                                            <div className="md:col-span-4 text-sm text-gray-500 flex items-center">
                                                {formatDateTimeCompact(testCase.updatedAt)}
                                            </div>
                                            <div className="md:col-span-5 flex justify-end gap-2">
                                                {(!testCase.testRuns[0] || !isActiveRunStatus(testCase.testRuns[0].status)) && (
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
                                                {testCase.testRuns[0] && isActiveRunStatus(testCase.testRuns[0].status) && (
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
                                                    className="cursor-pointer p-2 text-gray-500 hover:text-primary hover:bg-primary/10 rounded-md transition-colors inline-flex items-center justify-center"
                                                    title={t('project.tooltip.clone')}
                                                    aria-label={t('project.tooltip.clone')}
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                    </svg>
                                                </button>
                                                <button
                                                    onClick={() => setDeleteModal({ isOpen: true, testCaseId: testCase.id, testCaseName: testCase.name })}
                                                    disabled={testCase.testRuns[0] && isActiveRunStatus(testCase.testRuns[0].status)}
                                                    className={`p-2 rounded-md transition-colors inline-flex items-center justify-center ${testCase.testRuns[0] && isActiveRunStatus(testCase.testRuns[0].status)
                                                        ? 'text-gray-300 cursor-not-allowed'
                                                        : 'cursor-pointer text-gray-400 hover:text-red-600 hover:bg-red-50'
                                                        }`}
                                                    title={testCase.testRuns[0] && isActiveRunStatus(testCase.testRuns[0].status)
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
