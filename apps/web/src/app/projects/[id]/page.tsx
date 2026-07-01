"use client";
import { useState, useEffect, use, useCallback, useRef } from "react";
import { useAuth } from "../../auth-provider";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Modal, PageHeaderSkeleton, Pagination, TableRowsSkeleton, UnderlineTabs } from "@/components/shared";
import { Breadcrumbs } from "@/components/layout";
import { useI18n } from "@/i18n";
import { isActiveRunStatus } from '@/utils/status/statusHelpers';
import { extractListData, parsePageSize } from '@/utils/pagination/pagination';
import { ProjectConfigs } from '@/components/features/project-configurations';
import ProjectSettingsPanel from '@/components/features/projects/ui/ProjectSettingsPanel';
import { ProjectSchedulesPanel } from '@/components/features/project-scheduler';
import { TestGroupsPanel } from '@/components/features/test-groups';
import ProjectSlackSettings from '@/components/features/project-notifications/ui/ProjectSlackSettings';
import { useCurrentTeam } from '@/hooks/team/useCurrentTeam';
import TestCaseImportReviewDialog from '@/components/features/test-cases/ui/TestCaseImportReviewDialog';
import ProjectTestCasesToolbar from '@/components/features/test-cases/ui/ProjectTestCasesToolbar';
import {
    BatchImportResponse,
    SortIcon,
    handleBatchImportZipHelper,
    handleDiscardBatchImportHelper,
    handleExportSelectedHelper,
    runPendingBatchImportHelper,
    runBatchImportRequestHelper,
    type BatchImportMode,
} from './batch-operations';
import { filterProjectTestCases, sortProjectTestCases, toggleSelectAllFilteredTestCases, toggleSelectedTestCase } from './project-page-table';
import ProjectTestCaseRow from './ProjectTestCaseRow';
import type { Project, ProjectPageProps, ProjectTab, SortColumn, TestCase } from './project-page.types';

export default function ProjectPage({ params }: ProjectPageProps) {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const { currentTeam } = useCurrentTeam();
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
    const [sortColumn, setSortColumn] = useState<SortColumn>('id');
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
    const [pendingBatchImportFile, setPendingBatchImportFile] = useState<File | null>(null);
    const displayIdInputRef = useRef<HTMLInputElement | null>(null);
    const batchImportInputRef = useRef<HTMLInputElement | null>(null);
    const skipBlurSaveRef = useRef(false);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        if (project && currentTeam && project.teamId !== currentTeam.id) {
            router.replace(`/projects?teamId=${encodeURIComponent(currentTeam.id)}`);
        }
    }, [project, currentTeam, router]);

    useEffect(() => {
        const tab = searchParams.get('tab');
        if (tab === 'variables' || tab === 'integration' || tab === 'scheduler' || tab === 'settings' || tab === 'test-cases' || tab === 'login-flows' || tab === 'test-groups') {
            setActiveTab(tab);
        }
    }, [searchParams]);

    useEffect(() => {
        if (editingDisplayIdTestCaseId) {
            displayIdInputRef.current?.focus();
            displayIdInputRef.current?.select();
        }
    }, [editingDisplayIdTestCaseId]);

    useEffect(() => {
        const validIds = new Set(testCases.filter((item) => item.kind === 'TEST').map((item) => item.id));
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
        setSelectedTestCaseIds(new Set());
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

        setTestCases(extractListData<TestCase>(await testCasesRes.json()));
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
        const maxLimit = project.maxConcurrentRunsLimit ?? 2;

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

    const handleSort = (column: SortColumn) => {
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
        if (e.key === 'Enter') handleSearch();
    };

    const visibleTestCaseKind = activeTab === 'login-flows' ? 'LOGIN_FLOW' : 'TEST';
    const visibleTestCases = testCases.filter((testCase) => testCase.kind === visibleTestCaseKind);
    const schedulerTestCases = testCases.filter((testCase) => testCase.kind === 'TEST');
    const filteredTestCases = filterProjectTestCases(visibleTestCases, searchQuery);
    const sortedTestCases = sortProjectTestCases(filteredTestCases, sortColumn, sortDirection);

    const totalPages = Math.ceil(sortedTestCases.length / pageSize);
    const paginatedTestCases = sortedTestCases.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
    );

    const handlePageChange = (page: number) => setCurrentPage(page);

    const handlePageSizeChange = (size: number) => {
        setCurrentPage(1);
        const params = new URLSearchParams(searchParams.toString());
        params.set('limit', String(size));
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    const selectedCount = selectedTestCaseIds.size;
    const supportsSelection = activeTab === 'test-cases' || activeTab === 'login-flows';
    const allFilteredSelected = sortedTestCases.length > 0
        && sortedTestCases.every((testCase) => selectedTestCaseIds.has(testCase.id));

    const handleToggleSelectAllFiltered = () => {
        setSelectedTestCaseIds((prev) => toggleSelectAllFilteredTestCases({ previous: prev, sortedTestCases, allFilteredSelected }));
    };

    const handleToggleSelectTestCase = (testCaseId: string) => {
        setSelectedTestCaseIds((prev) => toggleSelectedTestCase(prev, testCaseId));
    };

    const runBatchImportRequest = useCallback(async (
        file: File,
        mode: BatchImportMode
    ): Promise<BatchImportResponse> => {
        return await runBatchImportRequestHelper({
            getAccessToken,
            projectId: id,
            file,
            mode,
        });
    }, [getAccessToken, id]);

    const handleBatchImportInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || !file.name.toLowerCase().endsWith('.zip')) {
            return;
        }
        await handleBatchImportZipHelper({
            file,
            runBatchImportRequest,
            fetchTestCases,
            setBatchImportReviewData,
            setPendingBatchImportFile,
            setIsBatchImportProcessing,
        });
    };

    const runPendingBatchImport = async (mode: 'import-valid' | 'import-all-draft') => {
        await runPendingBatchImportHelper({
            pendingBatchImportFile,
            mode,
            runBatchImportRequest,
            fetchTestCases,
            setBatchImportReviewData,
            setPendingBatchImportFile,
            setIsBatchImportProcessing,
        });
    };

    const handleDiscardBatchImport = () => {
        handleDiscardBatchImportHelper({
            setBatchImportReviewData,
            setPendingBatchImportFile,
        });
    };

    const handleExportSelected = async () => {
        if (selectedTestCaseIds.size === 0 || isExportingSelected) {
            return;
        }

        setIsExportingSelected(true);
        try {
            await handleExportSelectedHelper({
                getAccessToken,
                projectId: id,
                selectedTestCaseIds,
                fallbackProjectName: project?.name || 'project',
            });
        } catch (error) {
            console.error('Failed to export selected test cases', error);
        } finally {
            setIsExportingSelected(false);
        }
    };

    if (isAuthLoading || isLoading) {
        return (
            <main className="min-h-screen bg-gray-50">
                <div className="max-w-7xl mx-auto px-8 py-8">
                    <Breadcrumbs items={[{ label: '' }]} />
                    <PageHeaderSkeleton />
                    <div className="mb-6 flex gap-6 border-b border-gray-200">
                        {Array.from({ length: 5 }, (_, index) => (
                            <div key={`project-tab-skeleton-${index}`} className="skeleton-block mb-3 h-4 w-20" />
                        ))}
                    </div>
                    <TableRowsSkeleton rows={8} columns={5} />
                </div>
            </main>
        );
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
        { id: 'login-flows' as const, label: t('project.tab.loginFlows') },
        { id: 'test-groups' as const, label: t('project.tab.testGroups') },
        { id: 'scheduler' as const, label: t('project.tab.scheduler') },
        { id: 'integration' as const, label: t('project.tab.integration') },
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
                onImportComplete={() => runPendingBatchImport('import-valid')}
                onImportAllDraft={() => runPendingBatchImport('import-all-draft')}
                onDiscard={handleDiscardBatchImport}
            />
            <input
                ref={batchImportInputRef}
                type="file"
                accept=".zip,application/zip"
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

                {activeTab === 'login-flows' && (
                    <div className="mb-4 flex items-start gap-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-4">
                        <svg className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                        </svg>
                        <p className="text-sm text-indigo-900/80">{t('project.loginFlows.caption')}</p>
                    </div>
                )}

                {(activeTab === 'test-cases' || activeTab === 'login-flows') && (
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
                        createHref={activeTab === 'login-flows'
                            ? `/run?projectId=${id}&kind=LOGIN_FLOW`
                            : `/run?projectId=${id}`}
                        createLabel={activeTab === 'login-flows'
                            ? t('project.startNewLoginFlow')
                            : t('project.startNewRun')}
                        showImportExport={activeTab === 'test-cases' || activeTab === 'login-flows'}
                        t={t}
                    />
                )}

                {activeTab === 'variables' && (
                    <ProjectConfigs projectId={id} />
                )}

                {activeTab === 'test-groups' && project && (
                    <TestGroupsPanel projectId={id} canManageProject={Boolean(project.canManageProject)} />
                )}

                {activeTab === 'scheduler' && project && (
                    <ProjectSchedulesPanel
                        projectId={id}
                        canManageProject={Boolean(project.canManageProject)}
                        availableTestCases={schedulerTestCases.map((testCase) => ({
                            id: testCase.id,
                            displayId: testCase.displayId,
                            name: testCase.name,
                        }))}
                        t={t}
                    />
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

                {activeTab === 'integration' && project && currentTeam && (
                    <ProjectSlackSettings projectId={id} teamId={currentTeam.id} />
                )}

                <div className={`bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden ${activeTab !== 'test-cases' && activeTab !== 'login-flows' ? 'hidden' : ''}`}>
                    <div className="hidden md:grid grid-cols-24 gap-4 p-4 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-500">
                        {supportsSelection && (
                            <div className="col-span-1 flex items-center">
                                <input
                                    type="checkbox"
                                    checked={allFilteredSelected}
                                    onChange={handleToggleSelectAllFiltered}
                                    aria-label={t('project.table.selectAll')}
                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-30"
                                />
                            </div>
                        )}
                        <button
                            onClick={() => handleSort('id')}
                            className={`${supportsSelection ? 'col-span-3' : 'col-span-4'} flex items-center gap-1 hover:text-gray-700 transition-colors text-left`}
                        >
                            {t('project.table.id')}
                            <SortIcon column="id" sortColumn={sortColumn} sortDirection={sortDirection} />
                        </button>
                        <button
                            onClick={() => handleSort('name')}
                            className="col-span-8 xl:col-span-10 flex items-center gap-1 hover:text-gray-700 transition-colors text-left"
                        >
                            {t('project.table.name')}
                            <SortIcon column="name" sortColumn={sortColumn} sortDirection={sortDirection} />
                        </button>
                        <button
                            onClick={() => handleSort('status')}
                            className="col-span-3 xl:col-span-2 flex items-center gap-1 hover:text-gray-700 transition-colors text-left"
                        >
                            {t('project.table.status')}
                            <SortIcon column="status" sortColumn={sortColumn} sortDirection={sortDirection} />
                        </button>
                        <button
                            onClick={() => handleSort('updated')}
                            className="col-span-4 flex items-center gap-1 hover:text-gray-700 transition-colors text-left"
                        >
                            {t('project.table.updated')}
                            <SortIcon column="updated" sortColumn={sortColumn} sortDirection={sortDirection} />
                        </button>
                        <div className="col-span-5 xl:col-span-4 text-right">{t('project.table.actions')}</div>
                    </div>

                    {visibleTestCases.length === 0 ? (
                        <div className="p-16 text-center">
                            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                {activeTab === 'login-flows' ? t('project.noLoginFlows.title') : t('project.noTestCases.title')}
                            </h3>
                            <p className="text-gray-500 mb-6">
                                {activeTab === 'login-flows' ? t('project.noLoginFlows.subtitle') : t('project.noTestCases.subtitle')}
                            </p>
                            <Link
                                href={activeTab === 'login-flows' ? `/run?projectId=${id}&kind=LOGIN_FLOW` : `/run?projectId=${id}`}
                                className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                </svg>
                                {activeTab === 'login-flows' ? t('project.startNewLoginFlow') : t('project.startNewRun')}
                            </Link>
                        </div>
                    ) : (
                        <>
                        <div className="divide-y divide-gray-100">
                            {paginatedTestCases.map((testCase) => (
                                <ProjectTestCaseRow
                                    key={testCase.id}
                                    testCase={testCase}
                                    projectId={id}
                                    isSelected={selectedTestCaseIds.has(testCase.id)}
                                    canSelect={supportsSelection}
                                    onToggleSelect={handleToggleSelectTestCase}
                                    isEditingDisplayId={editingDisplayIdTestCaseId === testCase.id}
                                    isSavingDisplayId={savingDisplayIdTestCaseId === testCase.id}
                                    editingDisplayIdValue={editingDisplayIdValue}
                                    onEditingDisplayIdValueChange={setEditingDisplayIdValue}
                                    displayIdInputRef={displayIdInputRef}
                                    skipBlurSaveRef={skipBlurSaveRef}
                                    onStartDisplayIdEdit={startDisplayIdEdit}
                                    onSaveDisplayId={saveDisplayId}
                                    onClearDisplayIdEdit={clearDisplayIdEditState}
                                    onCloneTestCase={handleCloneTestCase}
                                    onRequestDelete={(target) => setDeleteModal({ isOpen: true, testCaseId: target.id, testCaseName: target.name })}
                                    t={t}
                                />
                            ))}
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
