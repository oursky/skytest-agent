"use client";

import { useState, useEffect, Suspense, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "../auth-provider";
import { TestForm } from "@/components/features/test-builder";
import { ResultViewer } from "@/components/features/run-results";
import { Breadcrumbs } from "@/components/layout";
import { PageHeaderSkeleton, PanelSkeleton } from "@/components/shared";
import TestCaseImportReviewDialog, { type TestCaseImportReviewData } from "@/components/features/test-cases/ui/TestCaseImportReviewDialog";
import {
    TEST_STATUS,
    isRunActiveStatus,
    isRunTerminalStatus,
    type TestStep,
    type BrowserConfig,
    type TargetConfig,
    type TestEvent,
    type TestCaseFile,
    type ConfigItem,
    type TestStatus,
} from "@/types";
import { parseTestCaseExcel, type ParsedTestCaseExcel } from "@/utils/excel/testCaseExcel";
import { useI18n } from "@/i18n";
import { useUnsavedChanges } from "@/hooks/run/useUnsavedChanges";
import {
    appendRunStreamEvent,
    applyRunStreamStatusUpdate,
    buildEventKey,
    isExcelFilename,
    mergeRunFormData,
    runDetailSnapshotToResult,
    RunViewerResult,
    type RunDetailSnapshot,
} from "./utils";
import {
    filterSupportedVariableConfigs,
    handleExportHelper,
    importVariablesToProjectHelper,
    importVariablesToTestCaseHelper,
} from "./import-export-helpers";
import {
    buildImportReviewData,
    discardImportReviewHelper,
    handleProceedImportReviewHelper,
} from "./run-page-import-review";
import { ensureTestCaseFromDataHelper } from "./run-page-test-case-helper";

interface TestData {
    url: string;
    prompt: string;
    name?: string;
    displayId?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
}

type TestResult = RunViewerResult;

function RunPageContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const { t } = useI18n();
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<TestResult>({
        status: null,
        events: [],
    });
    const eventSourceRef = useRef<EventSource | null>(null);
    const connectRequestIdRef = useRef(0);
    const eventKeySetRef = useRef<Set<string>>(new Set());
    const [currentTestCaseId, setCurrentTestCaseId] = useState<string | null>(null);
    const [currentRunId, setCurrentRunId] = useState<string | null>(null);
    const [projectIdFromTestCase, setProjectIdFromTestCase] = useState<string | null>(null);
    const [teamIdFromProject, setTeamIdFromProject] = useState<string | null>(null);
    const [projectName, setProjectName] = useState<string>('');

    const projectId = searchParams.get("projectId");
    const runId = searchParams.get("runId");
    const testCaseId = searchParams.get("testCaseId");
    const testCaseName = searchParams.get("name");
    const [initialData, setInitialData] = useState<TestData | undefined>(undefined);

    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [testCaseFiles, setTestCaseFiles] = useState<TestCaseFile[]>([]);
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [displayId, setDisplayId] = useState<string>('');
    const [testCaseStatus, setTestCaseStatus] = useState<TestStatus | null>(null);
    const [projectConfigs, setProjectConfigs] = useState<ConfigItem[]>([]);
    const [testCaseConfigs, setTestCaseConfigs] = useState<ConfigItem[]>([]);
    const [pendingImportData, setPendingImportData] = useState<ParsedTestCaseExcel | null>(null);
    const [importReviewData, setImportReviewData] = useState<TestCaseImportReviewData | null>(null);
    const [isImportReviewProcessing, setIsImportReviewProcessing] = useState(false);
    const refreshFilesRef = useRef<string | null>(null);
    useUnsavedChanges(isDirty);

    const importVariablesToTestCase = async (
        variables: Array<{ name: string; type: 'URL' | 'APP_ID' | 'VARIABLE' | 'RANDOM_STRING'; value: string; masked?: boolean; group?: string | null }>,
        sourceData: TestData
    ): Promise<string | null> => {
        return importVariablesToTestCaseHelper({
            variables,
            sourceData,
            testCaseId,
            currentTestCaseId,
            refreshFilesTestCaseId: refreshFilesRef.current,
            ensureTestCaseFromData,
            getAccessToken,
            fetchTestCaseConfigs,
        });
    };

    const importVariablesToProject = async (
        variables: Array<{ name: string; type: 'URL' | 'APP_ID' | 'VARIABLE' | 'RANDOM_STRING'; value: string; masked?: boolean; group?: string | null }>
    ): Promise<void> => {
        await importVariablesToProjectHelper({
            variables,
            projectId,
            projectIdFromTestCase,
            getAccessToken,
            fetchProjectConfigs,
        });
    };

    const handleExport = async (data: TestData) => {
        await handleExportHelper({
            data,
            testCaseId,
            currentTestCaseId,
            refreshFilesTestCaseId: refreshFilesRef.current,
            isDirty,
            testCaseFiles,
            projectConfigs,
            testCaseConfigs,
            projectId,
            projectIdFromTestCase,
            getAccessToken,
        });
    };

    const applyImportedExcelData = async (data: ParsedTestCaseExcel) => {
        setInitialData(data.testData);
        if (data.testCaseId) {
            setDisplayId(data.testCaseId);
        }
        setIsDirty(true);
        const supportedProjectVariables = filterSupportedVariableConfigs(data.projectVariables);
        const supportedTestCaseVariables = filterSupportedVariableConfigs(data.testCaseVariables);
        await importVariablesToProject(supportedProjectVariables);
        await importVariablesToTestCase(supportedTestCaseVariables, data.testData);
    };

    const handleProceedImportReview = async () => {
        await handleProceedImportReviewHelper({
            pendingImportData,
            setImportReviewData,
            setPendingImportData,
            setIsImportReviewProcessing,
            applyImportedExcelData,
        });
    };

    const handleDiscardImportReview = () => discardImportReviewHelper({ setImportReviewData, setPendingImportData });

    const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            if (!isExcelFilename(file.name)) return;

            const fileBuffer = await file.arrayBuffer();
            const parsed = await parseTestCaseExcel(fileBuffer);
            if (parsed.issues.length > 0) {
                setPendingImportData(parsed.data);
                setImportReviewData(buildImportReviewData(file.name, parsed.issues));
            } else {
                await applyImportedExcelData(parsed.data);
            }
        } catch (error) {
            console.error('Failed to import test case', error);
        }
        event.target.value = '';
    };

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    const fetchProjectName = useCallback(async (projId: string) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/projects/${projId}`, { headers });
            if (response.ok) {
                const data = await response.json() as { name?: string; teamId?: string | null };
                setProjectName(typeof data.name === 'string' ? data.name : '');
                setTeamIdFromProject(typeof data.teamId === 'string' ? data.teamId : null);
            }
        } catch (error) {
            console.error("Failed to fetch project name", error);
        }
    }, [getAccessToken]);

    const fetchTestCase = useCallback(async (id: string) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-cases/${id}`, { headers });
            if (response.ok) {
                const data = await response.json();

                setInitialData({
                    name: data.name,
                    url: data.url,
                    prompt: data.prompt,
                    steps: data.steps,
                    browserConfig: data.browserConfig,
                });

                setProjectIdFromTestCase(data.projectId);
                if (typeof data.projectName === 'string') {
                    setProjectName(data.projectName);
                } else {
                    fetchProjectName(data.projectId);
                }
                if (typeof data.projectTeamId === 'string') {
                    setTeamIdFromProject(data.projectTeamId);
                }
                setDisplayId(data.displayId || '');
                setTestCaseStatus(data.status || null);

                if (data.files) {
                    setTestCaseFiles(data.files);
                }

                if (data.testRuns && data.testRuns.length > 0) {
                    const latestRun = data.testRuns[0];
                    if (isRunActiveStatus(latestRun.status)) {
                        setActiveRunId(latestRun.id);
                    } else {
                        setActiveRunId(null);
                    }
                }
            }
        } catch (error) {
            console.error("Failed to fetch test case", error);
        }
    }, [fetchProjectName, getAccessToken]);

    const fetchTestRun = useCallback(async (id: string) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-runs/${id}`, { headers });
            if (response.ok) {
                const data = await response.json() as {
                    configurationSnapshot?: string | null;
                    testCaseId?: string;
                    testCaseDisplayId?: string | null;
                    testCaseName?: string;
                    testCaseUrl?: string;
                    testCasePrompt?: string | null;
                    testCaseSteps?: TestStep[];
                    testCaseBrowserConfig?: Record<string, BrowserConfig | TargetConfig>;
                    projectId?: string;
                    projectName?: string;
                    projectTeamId?: string | null;
                    files?: TestCaseFile[];
                };

                const fallbackData: Partial<TestData> = {
                    name: data.testCaseName ?? undefined,
                    displayId: data.testCaseDisplayId ?? undefined,
                    url: data.testCaseUrl ?? undefined,
                    prompt: data.testCasePrompt ?? undefined,
                    steps: data.testCaseSteps ?? undefined,
                    browserConfig: data.testCaseBrowserConfig ?? undefined,
                };

                let snapshotData: Partial<TestData> | null = null;
                if (data.configurationSnapshot) {
                    try {
                        snapshotData = JSON.parse(data.configurationSnapshot) as Partial<TestData>;
                    } catch (e) {
                        console.error("Failed to parse configuration snapshot", e);
                    }
                }

                setInitialData((previous) => mergeRunFormData({
                    snapshot: snapshotData,
                    fallback: fallbackData,
                    previous,
                }));

                if (typeof snapshotData?.displayId === 'string') {
                    setDisplayId(snapshotData.displayId);
                } else if (typeof data.testCaseDisplayId === 'string') {
                    setDisplayId(data.testCaseDisplayId);
                }

                if (typeof data.projectId === 'string') {
                    setProjectIdFromTestCase(data.projectId);
                }
                if (typeof data.projectName === 'string') {
                    setProjectName(data.projectName);
                }
                if (typeof data.projectTeamId === 'string') {
                    setTeamIdFromProject(data.projectTeamId);
                }
                if (Array.isArray(data.files)) {
                    setTestCaseFiles(data.files);
                }
                if (typeof data.testCaseId === 'string') {
                    setCurrentTestCaseId(data.testCaseId);
                    refreshFilesRef.current = data.testCaseId;
                    if (!testCaseId) {
                        fetchTestCase(data.testCaseId);
                    }
                }
            }
        } catch (error) {
            console.error("Failed to fetch test run", error);
        }
    }, [fetchTestCase, getAccessToken, testCaseId]);

    const fetchRunResultSnapshot = useCallback(async (id: string): Promise<RunViewerResult | null> => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-runs/${id}`, { headers });
            if (!response.ok) {
                return null;
            }

            const data = await response.json() as RunDetailSnapshot;
            return runDetailSnapshotToResult(data);
        } catch (error) {
            console.error("Failed to fetch test run result snapshot", error);
            return null;
        }
    }, [getAccessToken]);

    const applyRunResultSnapshot = useCallback((snapshot: RunViewerResult) => {
        eventKeySetRef.current = new Set(snapshot.events.map(buildEventKey));
        setResult(snapshot);
        if (snapshot.status && isRunTerminalStatus(snapshot.status)) {
            setIsLoading(false);
        }
    }, []);

    const fetchProjectConfigs = useCallback(async (projId: string) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/projects/${projId}/configs`, { headers });
            if (response.ok) {
                setProjectConfigs(await response.json());
            } else {
                setProjectConfigs([]);
            }
        } catch (error) {
            console.error("Failed to fetch project configs", error);
            setProjectConfigs([]);
        }
    }, [getAccessToken]);

    const fetchTestCaseConfigs = useCallback(async (tcId: string) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-cases/${tcId}/configs`, { headers });
            if (response.ok) {
                setTestCaseConfigs(await response.json());
            } else {
                setTestCaseConfigs([]);
            }
        } catch (error) {
            console.error("Failed to fetch test case configs", error);
            setTestCaseConfigs([]);
        }
    }, [getAccessToken]);

    useEffect(() => {
        const effectiveProjectId = projectId || projectIdFromTestCase;
        if (effectiveProjectId) {
            fetchProjectConfigs(effectiveProjectId);
        } else {
            setProjectConfigs([]);
        }
    }, [projectId, projectIdFromTestCase, fetchProjectConfigs]);

    useEffect(() => {
        const tcId = testCaseId || currentTestCaseId;
        if (tcId) {
            fetchTestCaseConfigs(tcId);
        } else {
            setTestCaseConfigs([]);
        }
    }, [testCaseId, currentTestCaseId, fetchTestCaseConfigs]);

    const refreshFiles = useCallback(async (overrideId?: string) => {
        const id = overrideId || refreshFilesRef.current || testCaseId || currentTestCaseId;
        if (!id) return;

        if (overrideId && !currentTestCaseId && !testCaseId) {
            setCurrentTestCaseId(overrideId);
        }

        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-cases/${id}/files`, { headers });
            if (response.ok) {
                const files = await response.json();
                setTestCaseFiles(files);
            }
        } catch (error) {
            console.error("Failed to fetch files", error);
        }
    }, [currentTestCaseId, getAccessToken, testCaseId]);

    const issueStreamToken = useCallback(async (scope: 'test-run-events', resourceId: string): Promise<string | null> => {
        const token = await getAccessToken();
        if (!token) return null;

        const response = await fetch('/api/stream-tokens', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ scope, resourceId }),
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json() as { streamToken?: string };
        return typeof data.streamToken === 'string' ? data.streamToken : null;
    }, [getAccessToken]);

    const connectToRun = useCallback(async (runId: string) => {
        connectRequestIdRef.current += 1;
        const requestId = connectRequestIdRef.current;

        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        eventKeySetRef.current = new Set();

        setResult(prev => ({
            ...prev,
            status: prev.status ?? TEST_STATUS.QUEUED,
            events: [],
            error: undefined,
            errorCode: undefined,
            errorCategory: undefined,
        }));
        setCurrentRunId(runId);

        const streamToken = await issueStreamToken('test-run-events', runId);
        if (requestId !== connectRequestIdRef.current) {
            return;
        }

        if (!streamToken) {
            const snapshot = await fetchRunResultSnapshot(runId);
            if (requestId !== connectRequestIdRef.current) {
                return;
            }
            if (snapshot) {
                applyRunResultSnapshot(snapshot);
            }
            if (!snapshot?.status || !isRunTerminalStatus(snapshot.status)) {
                setResult(prev => ({
                    ...prev,
                    error: t('run.error.connectionLost')
                }));
            }
            setIsLoading(false);
            return;
        }

        const url = `/api/test-runs/${runId}/events?streamToken=${encodeURIComponent(streamToken)}`;
        const es = new EventSource(url);

        es.onmessage = (event) => {
            if (requestId !== connectRequestIdRef.current) {
                return;
            }

            try {
                const data = JSON.parse(event.data);

                if (data.type === 'status') {
                    setResult(prev => {
                        const { next, shouldStopLoading } = applyRunStreamStatusUpdate(prev, data);
                        if (shouldStopLoading) {
                            setIsLoading(false);
                        }
                        return next;
                    });
                } else if (data.type === 'log' || data.type === 'screenshot') {
                    const streamEvent = data as TestEvent;
                    const eventKey = buildEventKey(streamEvent);
                    if (eventKeySetRef.current.has(eventKey)) {
                        return;
                    }
                    eventKeySetRef.current.add(eventKey);

                    setResult(prev => ({
                        ...appendRunStreamEvent(prev, streamEvent)
                    }));
                }
            } catch (e) {
                console.error('Failed to parse event', e);
            }
        };

        es.onerror = () => {
            if (requestId !== connectRequestIdRef.current) {
                es.close();
                return;
            }

            console.log('EventSource connection closed or error occurred');
            es.close();
            eventSourceRef.current = null;

            void (async () => {
                const snapshot = await fetchRunResultSnapshot(runId);
                if (requestId !== connectRequestIdRef.current) {
                    return;
                }
                if (snapshot) {
                    applyRunResultSnapshot(snapshot);
                    if (snapshot.status && isRunTerminalStatus(snapshot.status)) {
                        return;
                    }
                }

                setIsLoading(false);
                setResult(prev => {
                    if (isRunTerminalStatus(prev.status)) {
                        return prev;
                    }
                    return { ...prev, error: t('run.error.connectionLost') };
                });
            })();
        };

        if (requestId !== connectRequestIdRef.current) {
            es.close();
            return;
        }

        eventSourceRef.current = es;
    }, [applyRunResultSnapshot, fetchRunResultSnapshot, issueStreamToken, t]);

    useEffect(() => {
        if (projectId) fetchProjectName(projectId);
    }, [projectId, fetchProjectName]);

    useEffect(() => {
        if (projectIdFromTestCase && !projectId && !projectName) fetchProjectName(projectIdFromTestCase);
    }, [projectIdFromTestCase, projectId, projectName, fetchProjectName]);

    useEffect(() => {
        if (!runId || isAuthLoading || !isLoggedIn) return;
        fetchTestRun(runId);
        connectToRun(runId);
    }, [runId, isAuthLoading, isLoggedIn, fetchTestRun, connectToRun]);

    useEffect(() => {
        return () => {
            connectRequestIdRef.current += 1;
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
            eventKeySetRef.current.clear();
        };
    }, []);

    useEffect(() => {
        if (isAuthLoading) return;
        if (!isLoggedIn) return;

        if (testCaseId) {
            fetchTestCase(testCaseId);
            refreshFiles(testCaseId);
        } else if (testCaseName) {
            setInitialData({ name: testCaseName, url: '', prompt: '' });
        }
    }, [testCaseId, testCaseName, isAuthLoading, isLoggedIn, fetchTestCase, refreshFiles]);

    const handleStopTest = async () => {
        if (!currentRunId) return;
        setIsLoading(true);
        try {
            connectRequestIdRef.current += 1;
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const resp = await fetch(`/api/test-runs/${currentRunId}/cancel`, { method: 'POST', headers });
            if (!resp.ok) throw new Error(t('run.error.failedToStop'));
            setResult(prev => ({ ...prev, status: TEST_STATUS.CANCELLED, error: t('run.error.testStopped'), errorCode: undefined, errorCategory: undefined }));
            setTestCaseStatus(TEST_STATUS.CANCELLED);
            setActiveRunId(null);
            setCurrentRunId(null);
        } catch (error) {
            console.error('Failed to stop test', error);
            alert(t('run.error.failedToStop'));
        } finally {
            setIsLoading(false);
        }
    };

    const saveTestCase = useCallback(async (data: TestData, options?: { saveDraft?: boolean }): Promise<string | null> => {
        const effectiveTestCaseId = testCaseId || currentTestCaseId;
        const effectiveProjectId = projectId || projectIdFromTestCase;
        const finalDisplayId = (data.displayId ?? displayId ?? '').trim();

        if (!finalDisplayId) {
            throw new Error(t('run.error.testCaseIdRequired'));
        }

        const token = await getAccessToken();
        const headers: HeadersInit = {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
        };

        if (effectiveTestCaseId) {
            const response = await fetch(`/api/test-cases/${effectiveTestCaseId}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({ ...data, displayId: finalDisplayId, ...(options?.saveDraft ? { saveDraft: true } : {}) }),
            });
            if (!response.ok) {
                throw new Error('Failed to save test case');
            }
            setIsDirty(false);
            return effectiveTestCaseId;
        } else {
            if (!effectiveProjectId) {
                return null;
            }

            const response = await fetch(`/api/projects/${effectiveProjectId}/test-cases`, {
                method: "POST",
                headers,
                body: JSON.stringify({ ...data, displayId: finalDisplayId, ...(options?.saveDraft ? { saveDraft: true } : {}) }),
            });
            if (!response.ok) {
                throw new Error('Failed to create test case');
            }

            const newTestCase = await response.json();
            setCurrentTestCaseId(newTestCase.id);
            window.history.replaceState(null, "", `?testCaseId=${newTestCase.id}&projectId=${effectiveProjectId}`);
            setIsDirty(false);
            return newTestCase.id;
        }
    }, [testCaseId, currentTestCaseId, projectId, projectIdFromTestCase, displayId, getAccessToken, t]);

    const handleRunTest = useCallback(async (data: TestData) => {
        setIsLoading(true);
        setResult({
            status: null,
            events: [],
            error: undefined,
            errorCode: undefined,
            errorCategory: undefined,
        });

        let activeTestCaseId: string | null;

        try {
            activeTestCaseId = await saveTestCase(data);
        } catch (error) {
            console.error("Failed to save test case", error);
            const errorMessage = error instanceof Error ? error.message : t('run.error.failedToSave');
            setResult({ status: TEST_STATUS.FAIL, events: [], error: errorMessage, errorCode: undefined, errorCategory: undefined });
            setIsLoading(false);
            return;
        }

        if (!activeTestCaseId) {
            setResult({ status: TEST_STATUS.FAIL, events: [], error: t('run.error.selectOrCreate'), errorCode: undefined, errorCategory: undefined });
            setIsLoading(false);
            return;
        }

        try {
            const token = await getAccessToken();
            const response = await fetch('/api/test-runs/dispatch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ ...data, testCaseId: activeTestCaseId }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const { runId, error } = await response.json();
            if (error) throw new Error(error);

            connectToRun(runId);

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
            setResult(prev => ({ ...prev, status: TEST_STATUS.FAIL, error: errorMessage, errorCode: undefined, errorCategory: undefined }));
            setIsLoading(false);
        }
    }, [saveTestCase, getAccessToken, t, connectToRun]);

    const handleSaveDraft = useCallback(async (data: TestData) => {
        if (!data.name?.trim()) {
            alert(t('run.error.nameRequired'));
            return;
        }
        if (!data.displayId?.trim()) {
            alert(t('run.error.testCaseIdRequired'));
            return;
        }

        const effectiveProjectId = projectId || projectIdFromTestCase;
        if (!effectiveProjectId && !testCaseId && !currentTestCaseId) {
            alert(t('run.error.noProjectSelected'));
            return;
        }

        setIsSaving(true);
        try {
            await saveTestCase(data, { saveDraft: true });

            if (effectiveProjectId) {
                router.push(`/projects/${effectiveProjectId}`);
            } else {
                router.push('/projects');
            }
        } catch (error) {
            console.error('Failed to save draft', error);
            alert(t('run.error.failedToSave'));
        } finally {
            setIsSaving(false);
        }
    }, [testCaseId, currentTestCaseId, projectId, projectIdFromTestCase, saveTestCase, t, router]);

    const handleDiscard = useCallback(() => {
        const effectiveProjectId = projectId || projectIdFromTestCase;
        if (effectiveProjectId) {
            router.push(`/projects/${effectiveProjectId}`);
        } else {
            router.push('/projects');
        }
    }, [projectId, projectIdFromTestCase, router]);

    const handleDisplayIdChange = useCallback((newDisplayId: string) => { setDisplayId(newDisplayId); setIsDirty(true); }, []);

    const ensureTestCaseFromData = async (
        data: TestData,
        options?: { suppressAlert?: boolean }
    ): Promise<string> => {
        return await ensureTestCaseFromDataHelper({
            data,
            suppressAlert: options?.suppressAlert === true,
            testCaseId,
            currentTestCaseId,
            projectId,
            projectIdFromTestCase,
            displayId,
            getAccessToken,
            t,
            setCurrentTestCaseId,
            setInitialData: (nextInitialData) => {
                setInitialData(nextInitialData);
            },
            setRefreshFilesTestCaseId: (newTestCaseId) => {
                refreshFilesRef.current = newTestCaseId;
            },
        });
    };

    const testCaseHasActiveRun = isRunActiveStatus(testCaseStatus);
    const isRunInProgress =
        isLoading
        || isRunActiveStatus(result.status)
        || !!activeRunId
        || testCaseHasActiveRun;

    if (isAuthLoading) {
        return <RunPageSkeleton />;
    }

    return (
        <>
            {(projectId || projectIdFromTestCase) && projectName && (
                <Breadcrumbs items={[
                    { label: projectName, href: `/projects/${projectId || projectIdFromTestCase}` },
                    { label: testCaseId ? t('run.breadcrumb.runTest') : t('run.breadcrumb.newRun') }
                ]} />
            )}

            <TestCaseImportReviewDialog
                isOpen={importReviewData !== null}
                data={importReviewData}
                isProcessing={isImportReviewProcessing}
                onProceed={handleProceedImportReview}
                onDiscard={handleDiscardImportReview}
            />

            <input
                type="file"
                ref={fileInputRef}
                onChange={handleImport}
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
            />

            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold text-gray-900">
                    {testCaseId ? t('run.title.runTest') : t('run.title.startNewRun')}
                </h1>
                <div className="flex items-center gap-2">
                    {isRunActiveStatus(result.status) && (
                        <button
                            onClick={handleStopTest}
                            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                            </svg>
                            {result.status === TEST_STATUS.QUEUED ? t('run.button.quitQueue') : t('run.button.stopTest')}
                        </button>
                    )}
                </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                <div className="space-y-6">
                    {activeRunId && activeRunId !== currentRunId ? (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
                            <h3 className="text-lg font-semibold text-blue-900 mb-2">{t('run.testInProgress.title')}</h3>
                            <p className="text-blue-700 mb-4">{t('run.testInProgress.subtitle')}</p>
                            <button
                                onClick={() => {
                                    window.history.pushState(null, "", `?runId=${activeRunId}&testCaseId=${testCaseId}&projectId=${projectId || projectIdFromTestCase}`);
                                    fetchTestRun(activeRunId);
                                    connectToRun(activeRunId);
                                }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                            >
                                {t('run.testInProgress.view')}
                            </button>
                        </div>
                    ) : (
                        <TestForm
                            onSubmit={handleRunTest}
                            isLoading={isLoading || (!!activeRunId && activeRunId === currentRunId)}
                            submitOnEnter={false}
                            initialData={initialData}
                            showNameInput={true}
                            readOnly={isRunInProgress}
                            onExport={handleExport}
                            onImport={isRunInProgress ? undefined : () => fileInputRef.current?.click()}
                            testCaseId={testCaseId || currentTestCaseId || refreshFilesRef.current || undefined}
                            onSaveDraft={handleSaveDraft}
                            onDiscard={handleDiscard}
                            isSaving={isSaving}
                            displayId={displayId}
                            onDisplayIdChange={handleDisplayIdChange}
                            projectId={projectId || projectIdFromTestCase || undefined}
                            teamId={teamIdFromProject || undefined}
                            projectConfigs={projectConfigs}
                            testCaseConfigs={testCaseConfigs}
                            testCaseFiles={testCaseFiles}
                            onTestCaseConfigsChange={(updatedTestCaseId) => {
                                const tcId = updatedTestCaseId || testCaseId || currentTestCaseId;
                                if (tcId) fetchTestCaseConfigs(tcId);
                            }}
                            onEnsureTestCase={ensureTestCaseFromData}
                        />
                    )}
                </div>
                <div className="h-full">
                    <ResultViewer
                        result={result}
                        meta={{
                            runId: currentRunId,
                            testCaseId: testCaseId || currentTestCaseId || refreshFilesRef.current,
                            projectId: projectId || projectIdFromTestCase,
                            projectName,
                            testCaseName: initialData?.name || null,
                            config: initialData,
                            files: testCaseFiles,
                        }}
                    />
                </div>
            </div>
        </>
    );
}

export default function RunPage() {
    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <Suspense fallback={<RunPageSkeleton />}>
                    <RunPageContent />
                </Suspense>
            </div>
        </main>
    );
}

function RunPageSkeleton() {
    return (
        <div className="max-w-7xl mx-auto">
            <PageHeaderSkeleton withAction={false} />
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 items-start">
                <PanelSkeleton className="min-h-[30rem] lg:min-h-[40rem]" lines={8} />
                <PanelSkeleton className="min-h-[30rem] lg:min-h-[40rem]" lines={8} />
            </div>
        </div>
    );
}
