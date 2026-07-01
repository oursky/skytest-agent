"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "../auth-provider";
import { TestForm } from "@/components/features/test-builder";
import { ResultViewer } from "@/components/features/run-results";
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
    type TestCaseKind,
} from "@/types";
import { useI18n } from "@/i18n";
import { useUnsavedChanges } from "@/hooks/run/useUnsavedChanges";
import {
    appendRunStreamEvent,
    applyRunStreamStatusUpdate,
    buildEventKey,
    buildRunPageView,
    mergeRunFormData,
    runDetailSnapshotToResult,
    RunViewerResult,
    type RunDetailSnapshot,
} from "./utils";
import { ensureTestCaseFromDataHelper } from "./run-page-test-case-helper";
import { fetchWithAccessToken, issueRunStreamToken } from "./run-page-api";
import { ActiveRunPanel, RunPageHeader, RunPageLayout, RunPageSkeleton } from "./run-page-panels";

interface TestData {
    url: string;
    prompt: string;
    name?: string;
    displayId?: string;
    kind?: TestCaseKind;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
}
function RunPageContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const { t } = useI18n();
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<RunViewerResult>({
        status: null,
        events: [],
    });
    const eventSourceRef = useRef<EventSource | null>(null);
    const connectRequestIdRef = useRef(0);
    const eventKeySetRef = useRef<Set<string>>(new Set());
    const reconnectAttemptRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [currentTestCaseId, setCurrentTestCaseId] = useState<string | null>(null);
    const [currentRunId, setCurrentRunId] = useState<string | null>(null);
    const [projectIdFromTestCase, setProjectIdFromTestCase] = useState<string | null>(null);
    const [teamIdFromProject, setTeamIdFromProject] = useState<string | null>(null);
    const [projectName, setProjectName] = useState<string>('');

    const projectId = searchParams.get("projectId");
    const runId = searchParams.get("runId");
    const testCaseId = searchParams.get("testCaseId");
    const testCaseName = searchParams.get("name");
    const testCaseKind: TestCaseKind = searchParams.get("kind") === "LOGIN_FLOW" ? "LOGIN_FLOW" : "TEST";
    const [initialData, setInitialData] = useState<TestData | undefined>(undefined);
    const [isInitialDataLoading, setIsInitialDataLoading] = useState<boolean>(Boolean(testCaseId || runId));

    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const [testCaseFiles, setTestCaseFiles] = useState<TestCaseFile[]>([]);
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [displayId, setDisplayId] = useState<string>('');
    const [testCaseStatus, setTestCaseStatus] = useState<TestStatus | null>(null);
    const [projectConfigs, setProjectConfigs] = useState<ConfigItem[]>([]);
    const [testCaseConfigs, setTestCaseConfigs] = useState<ConfigItem[]>([]);
    const refreshFilesRef = useRef<string | null>(null);
    useUnsavedChanges(isDirty);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    const fetchProjectName = useCallback(async (projId: string) => {
        try {
            const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${projId}`);
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
            const response = await fetchWithAccessToken(getAccessToken, `/api/test-cases/${id}`);
            if (response.ok) {
                const data = await response.json();

                setInitialData({
                    name: data.name,
                    kind: data.kind === 'LOGIN_FLOW' ? 'LOGIN_FLOW' : 'TEST',
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
            const response = await fetchWithAccessToken(getAccessToken, `/api/test-runs/${id}`);
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
            const response = await fetchWithAccessToken(getAccessToken, `/api/test-runs/${id}`);
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
            const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${projId}/configs`);
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
            const response = await fetchWithAccessToken(getAccessToken, `/api/test-cases/${tcId}/configs`);
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
            const response = await fetchWithAccessToken(getAccessToken, `/api/test-cases/${id}/files`);
            if (response.ok) {
                const files = await response.json();
                setTestCaseFiles(files);
            }
        } catch (error) {
            console.error("Failed to fetch files", error);
        }
    }, [currentTestCaseId, getAccessToken, testCaseId]);

    const connectToRun = useCallback(async (runId: string, options?: { preserveStreamState?: boolean }) => {
        const preserveStreamState = options?.preserveStreamState === true;
        connectRequestIdRef.current += 1;
        const requestId = connectRequestIdRef.current;

        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }

        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        if (!preserveStreamState) {
            eventKeySetRef.current = new Set();
            reconnectAttemptRef.current = 0;
        }

        if (!preserveStreamState) {
            setResult(prev => ({
                ...prev,
                status: prev.status ?? TEST_STATUS.QUEUED,
                events: [],
                error: undefined,
                errorCode: undefined,
                errorCategory: undefined,
            }));
        }
        setCurrentRunId(runId);

        const streamToken = await issueRunStreamToken(getAccessToken, runId);
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
            if (snapshot?.status && isRunTerminalStatus(snapshot.status)) {
                reconnectAttemptRef.current = 0;
                return;
            }
            setResult(prev => ({
                ...prev,
                error: t('run.error.connectionLost')
            }));
            const attempt = reconnectAttemptRef.current + 1;
            reconnectAttemptRef.current = attempt;
            const retryDelayMs = Math.min(10_000, Math.max(1_000, 1_000 * (2 ** (attempt - 1))));
            reconnectTimerRef.current = setTimeout(() => {
                if (requestId !== connectRequestIdRef.current) {
                    return;
                }
                void connectToRun(runId, { preserveStreamState: true });
            }, retryDelayMs);
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
                            reconnectAttemptRef.current = 0;
                        } else {
                            reconnectAttemptRef.current = 0;
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
                        reconnectAttemptRef.current = 0;
                        return;
                    }
                }

                setResult(prev => (
                    isRunTerminalStatus(prev.status)
                        ? prev
                        : { ...prev, error: t('run.error.connectionLost') }
                ));

                const attempt = reconnectAttemptRef.current + 1;
                reconnectAttemptRef.current = attempt;
                const retryDelayMs = Math.min(10_000, Math.max(1_000, 1_000 * (2 ** (attempt - 1))));
                reconnectTimerRef.current = setTimeout(() => {
                    if (requestId !== connectRequestIdRef.current) {
                        return;
                    }
                    void connectToRun(runId, { preserveStreamState: true });
                }, retryDelayMs);
            })();
        };

        if (requestId !== connectRequestIdRef.current) {
            es.close();
            return;
        }

        eventSourceRef.current = es;
    }, [applyRunResultSnapshot, fetchRunResultSnapshot, getAccessToken, t]);

    useEffect(() => {
        if (projectId) fetchProjectName(projectId);
    }, [projectId, fetchProjectName]);

    useEffect(() => {
        if (projectIdFromTestCase && !projectId && !projectName) fetchProjectName(projectIdFromTestCase);
    }, [projectIdFromTestCase, projectId, projectName, fetchProjectName]);

    useEffect(() => {
        if (!runId || isAuthLoading || !isLoggedIn) return;
        void (async () => {
            try {
                await fetchTestRun(runId);
            } finally {
                setIsInitialDataLoading(false);
            }
        })();
        connectToRun(runId);
    }, [runId, isAuthLoading, isLoggedIn, fetchTestRun, connectToRun]);

    useEffect(() => {
        return () => {
            connectRequestIdRef.current += 1;
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
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
            void (async () => {
                try {
                    await fetchTestCase(testCaseId);
                } finally {
                    setIsInitialDataLoading(false);
                }
            })();
            refreshFiles(testCaseId);
        } else if (testCaseName) {
            setInitialData({ name: testCaseName, url: '', prompt: '', kind: testCaseKind });
        } else if (testCaseKind === 'LOGIN_FLOW') {
            setInitialData({ name: '', url: '', prompt: '', kind: testCaseKind });
        }
    }, [testCaseId, testCaseName, testCaseKind, isAuthLoading, isLoggedIn, fetchTestCase, refreshFiles]);

    const handleStopTest = async () => {
        if (!currentRunId) return;
        setIsLoading(true);
        try {
            connectRequestIdRef.current += 1;
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
            const resp = await fetchWithAccessToken(getAccessToken, `/api/test-runs/${currentRunId}/cancel`, { method: 'POST' });
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

        if (effectiveTestCaseId) {
            const response = await fetchWithAccessToken(getAccessToken, `/api/test-cases/${effectiveTestCaseId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...data, kind: data.kind ?? testCaseKind, displayId: finalDisplayId, ...(options?.saveDraft ? { saveDraft: true } : {}) }),
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

            const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${effectiveProjectId}/test-cases`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...data, kind: data.kind ?? testCaseKind, displayId: finalDisplayId, ...(options?.saveDraft ? { saveDraft: true } : {}) }),
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
    }, [testCaseId, currentTestCaseId, projectId, projectIdFromTestCase, displayId, testCaseKind, getAccessToken, t]);

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
            const response = await fetchWithAccessToken(getAccessToken, '/api/test-runs/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
                router.push(`/projects/${effectiveProjectId}${(data.kind ?? testCaseKind) === 'LOGIN_FLOW' ? '?tab=login-flows' : ''}`);
            } else {
                router.push('/projects');
            }
        } catch (error) {
            console.error('Failed to save draft', error);
            alert(t('run.error.failedToSave'));
        } finally {
            setIsSaving(false);
        }
    }, [testCaseId, currentTestCaseId, projectId, projectIdFromTestCase, saveTestCase, testCaseKind, t, router]);

    const handleDiscard = useCallback(() => {
        const effectiveProjectId = projectId || projectIdFromTestCase;
        if (effectiveProjectId) {
            router.push(`/projects/${effectiveProjectId}${(initialData?.kind ?? testCaseKind) === 'LOGIN_FLOW' ? '?tab=login-flows' : ''}`);
        } else {
            router.push('/projects');
        }
    }, [projectId, projectIdFromTestCase, initialData?.kind, testCaseKind, router]);

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

    if (isAuthLoading || isInitialDataLoading) {
        return <RunPageSkeleton />;
    }

    const runView = buildRunPageView(initialData?.kind ?? testCaseKind, !!testCaseId, t);

    const breadcrumbItems = (projectId || projectIdFromTestCase) && projectName
        ? [{ label: projectName, href: `/projects/${projectId || projectIdFromTestCase}${runView.isLoginFlow ? '?tab=login-flows' : ''}` }, { label: runView.breadcrumbLabel }]
        : undefined;

    return (
        <>
            <RunPageHeader
                title={runView.headerTitle}
                subtitle={runView.headerSubtitle}
                breadcrumbItems={breadcrumbItems}
                showStopButton={isRunActiveStatus(result.status)}
                stopLabel={result.status === TEST_STATUS.QUEUED ? t('run.button.quitQueue') : t('run.button.stopTest')}
                onStop={handleStopTest}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                <div className="space-y-6">
                    {activeRunId && activeRunId !== currentRunId ? (
                        <ActiveRunPanel
                            title={t('run.testInProgress.title')}
                            subtitle={t('run.testInProgress.subtitle')}
                            viewLabel={t('run.testInProgress.view')}
                            onView={() => {
                                window.history.pushState(null, "", `?runId=${activeRunId}&testCaseId=${testCaseId}&projectId=${projectId || projectIdFromTestCase}`);
                                fetchTestRun(activeRunId);
                                connectToRun(activeRunId);
                            }}
                        />
                    ) : (
                        <TestForm
                            onSubmit={handleRunTest}
                            isLoading={isLoading || (!!activeRunId && activeRunId === currentRunId)}
                            submitOnEnter={false}
                            initialData={initialData}
                            showNameInput={true}
                            readOnly={isRunInProgress}
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
        <RunPageLayout>
            <RunPageContent />
        </RunPageLayout>
    );
}
