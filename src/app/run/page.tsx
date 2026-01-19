"use client";

import { useState, useEffect, Suspense, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../auth-provider";
import TestForm from "@/components/TestForm";
import ResultViewer from "@/components/ResultViewer";
import Breadcrumbs from "@/components/Breadcrumbs";
import { TestStep, BrowserConfig, TestEvent, TestCaseFile } from "@/types";
import { exportToMarkdown, parseMarkdown } from "@/utils/testCaseMarkdown";
import { useI18n } from "@/i18n";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";

interface TestData {
    url: string;
    username?: string;
    password?: string;
    prompt: string;
    name?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig>;
}

interface TestResult {
    status: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL' | 'CANCELLED' | 'QUEUED';
    events: TestEvent[];
    error?: string;
}


function RunPageContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const { t } = useI18n();
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<TestResult>({
        status: 'IDLE',
        events: [],
    });
    const [eventSource, setEventSource] = useState<EventSource | null>(null);
    const [currentTestCaseId, setCurrentTestCaseId] = useState<string | null>(null);
    const [currentRunId, setCurrentRunId] = useState<string | null>(null);
    const [projectIdFromTestCase, setProjectIdFromTestCase] = useState<string | null>(null);
    const [projectName, setProjectName] = useState<string>('');

    const projectId = searchParams.get("projectId");
    const runId = searchParams.get("runId");
    const testCaseId = searchParams.get("testCaseId");
    const testCaseName = searchParams.get("name");
    const [initialData, setInitialData] = useState<TestData | undefined>(undefined);
    const [originalName, setOriginalName] = useState<string | null>(null);
    const [originalDisplayId, setOriginalDisplayId] = useState<string | null>(null);

    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [testCaseFiles, setTestCaseFiles] = useState<TestCaseFile[]>([]);
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [displayId, setDisplayId] = useState<string>('');
    const [testCaseStatus, setTestCaseStatus] = useState<string | null>(null);

    useUnsavedChanges(isDirty, t('run.unsavedChangesWarning'));

    const handleExport = () => {
        if (!initialData) return;
        const markdown = exportToMarkdown(initialData);
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${initialData.name || 'test-case'}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            const { data, errors } = parseMarkdown(content);
            if (errors.length > 0) {
                alert(t('testForm.importWarnings', { warnings: errors.join(', ') }));
            }
            setInitialData(data);
            if (data.name) {
                setOriginalName(null);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        if (projectId) fetchProjectName(projectId);
    }, [projectId]);

    useEffect(() => {
        if (projectIdFromTestCase && !projectId) fetchProjectName(projectIdFromTestCase);
    }, [projectIdFromTestCase, projectId]);

    useEffect(() => {
        if (runId) {
            fetchTestRun(runId);
            connectToRun(runId);
        }
    }, [runId]);

    useEffect(() => {
        return () => {
            if (eventSource) {
                eventSource.close();
            }
        };
    }, [eventSource]);

    useEffect(() => {
        if (isAuthLoading) return;
        if (!isLoggedIn) return;

        if (testCaseId) {
            fetchTestCase(testCaseId);
            refreshFiles(testCaseId);
        } else if (testCaseName) {
            setInitialData({ name: testCaseName, url: '', prompt: '' });
        }
    }, [testCaseId, testCaseName, isAuthLoading, isLoggedIn]);

    const fetchTestCase = async (id: string) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-cases/${id}`, { headers, cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                const hasSteps = data.steps && data.steps.length > 0;
                const hasBrowserConfig = data.browserConfig && Object.keys(data.browserConfig).length > 0;
                const mode = (hasSteps || hasBrowserConfig) ? 'builder' : 'simple';

                setInitialData({
                    name: data.name,
                    url: data.url,
                    prompt: data.prompt,
                    username: data.username || "",
                    password: data.password || "",
                    steps: data.steps,
                    browserConfig: data.browserConfig,
                });

                setOriginalName(data.name);
                setOriginalDisplayId(data.displayId || null);
                setProjectIdFromTestCase(data.projectId);
                fetchProjectName(data.projectId);
                setDisplayId(data.displayId || '');
                setTestCaseStatus(data.status || null);

                if (data.files) {
                    setTestCaseFiles(data.files);
                }

                if (data.testRuns && data.testRuns.length > 0) {
                    const latestRun = data.testRuns[0];
                    if (['RUNNING', 'QUEUED'].includes(latestRun.status)) {
                        setActiveRunId(latestRun.id);
                    } else {
                        setActiveRunId(null);
                    }
                }
            }
        } catch (error) {
            console.error("Failed to fetch test case", error);
        }
    };

    const fetchTestRun = async (id: string) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-runs/${id}`, { headers });
            if (response.ok) {
                const data = await response.json();

                if (data.configurationSnapshot) {
                    try {
                        const config = JSON.parse(data.configurationSnapshot);
                        setInitialData(config);

                        if (config.testCaseId) {
                            fetchTestCase(config.testCaseId);
                        }
                    } catch (e) {
                        console.error("Failed to parse configuration snapshot", e);
                    }
                }
            }
        } catch (error) {
            console.error("Failed to fetch test run", error);
        }
    };

    const fetchProjectName = async (projId: string) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/projects/${projId}`, { headers });
            if (response.ok) {
                const data = await response.json();
                setProjectName(data.name);
            }
        } catch (error) {
            console.error("Failed to fetch project name", error);
        }
    };

    const refreshFilesRef = useRef<string | null>(null);

    const refreshFiles = async (overrideId?: string) => {
        const id = overrideId || refreshFilesRef.current || testCaseId || currentTestCaseId;
        if (!id) return;

        if (overrideId && !currentTestCaseId && !testCaseId) {
            setCurrentTestCaseId(overrideId);
        }

        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-cases/${id}/files`, { headers, cache: 'no-store' });
            if (response.ok) {
                const files = await response.json();
                setTestCaseFiles(files);
            }
        } catch (error) {
            console.error("Failed to fetch files", error);
        }
    };

    const handleFilesChange = async (overrideId?: string, uploadedFiles?: TestCaseFile[]) => {
        if (overrideId && !currentTestCaseId && !testCaseId) {
            setCurrentTestCaseId(overrideId);
        }

        if (overrideId) {
            refreshFilesRef.current = overrideId;
        }

        if (uploadedFiles && uploadedFiles.length > 0) {
            setTestCaseFiles((prev) => {
                const seen = new Set(prev.map(f => f.id));
                const merged = [...uploadedFiles.filter(f => !seen.has(f.id)), ...prev];
                return merged;
            });
        }

        await refreshFiles(overrideId);
    };

    const connectToRun = async (runId: string) => {
        if (eventSource) eventSource.close();

        setResult(prev => ({
            ...prev,
            status: (prev.status === 'IDLE') ? 'QUEUED' : prev.status,
            events: []
        }));
        setCurrentRunId(runId);

        const token = await getAccessToken();
        const url = `/api/test-runs/${runId}/events${token ? `?token=${token}` : ''}`;
        const es = new EventSource(url);

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'status') {
                    setResult(prev => {
                        if (['PASS', 'FAIL', 'CANCELLED'].includes(data.status)) {
                            es.close();
                            setEventSource(null);
                            setIsLoading(false);
                        }
                        return { ...prev, status: data.status, error: data.error };
                    });
                } else if (data.type === 'log' || data.type === 'screenshot') {
                    setResult(prev => ({
                        ...prev,
                        events: [...prev.events, data]
                    }));
                }
            } catch (e) {
                console.error('Failed to parse event', e);
            }
        };

        es.onerror = (err) => {
            console.log('EventSource connection closed or error occurred');
            es.close();
            setEventSource(null);
            setIsLoading(false);

            setResult(prev => {
                if (['PASS', 'FAIL', 'CANCELLED'].includes(prev.status)) {
                    return prev;
                }
                return { ...prev, error: t('run.error.connectionLost') };
            });
        };

        setEventSource(es);
    };

    const handleStopTest = async () => {
        if (!currentRunId) return;
        setIsLoading(true);
        try {
            if (eventSource) {
                eventSource.close();
                setEventSource(null);
            }
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const resp = await fetch(`/api/test-runs/${currentRunId}/cancel`, { method: 'POST', headers });
            if (!resp.ok) throw new Error(t('run.error.failedToStop'));
            setResult(prev => ({ ...prev, status: 'CANCELLED', error: t('run.error.testStopped') }));
            setTestCaseStatus('CANCELLED');
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

        const nameChanged = originalName && data.name && data.name !== originalName;
        const displayIdChanged = originalDisplayId !== null && displayId !== (originalDisplayId || '');
        const shouldCreateNew = nameChanged && displayIdChanged;

        const token = await getAccessToken();
        const headers: HeadersInit = {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
        };

        if (effectiveTestCaseId && !shouldCreateNew) {
            const response = await fetch(`/api/test-cases/${effectiveTestCaseId}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({ ...data, displayId, ...(options?.saveDraft ? { saveDraft: true } : {}) }),
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
                body: JSON.stringify({ ...data, displayId }),
            });
            if (!response.ok) {
                throw new Error('Failed to create test case');
            }

            const newTestCase = await response.json();
            setCurrentTestCaseId(newTestCase.id);
            window.history.replaceState(null, "", `?testCaseId=${newTestCase.id}&projectId=${effectiveProjectId}`);
            setOriginalName(data.name || null);
            setOriginalDisplayId(displayId || null);
            setIsDirty(false);
            return newTestCase.id;
        }
    }, [testCaseId, currentTestCaseId, projectId, projectIdFromTestCase, originalName, originalDisplayId, displayId, getAccessToken]);

    const handleRunTest = useCallback(async (data: TestData) => {
        setIsLoading(true);
        setResult({
            status: 'IDLE',
            events: [],
        });

        let activeTestCaseId: string | null;

        try {
            activeTestCaseId = await saveTestCase(data);
        } catch (error) {
            console.error("Failed to save test case", error);
            setResult({ status: 'FAIL', events: [], error: t('run.error.failedToSave') });
            setIsLoading(false);
            return;
        }

        if (!activeTestCaseId) {
            setResult({ status: 'FAIL', events: [], error: t('run.error.selectOrCreate') });
            setIsLoading(false);
            return;
        }

        try {
            const token = await getAccessToken();
            const response = await fetch('/api/run-test', {
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
            setResult(prev => ({ ...prev, status: 'FAIL', error: errorMessage }));
            setIsLoading(false);
        }
    }, [saveTestCase, getAccessToken, t, connectToRun]);

    const handleSaveDraft = useCallback(async (data: TestData) => {
        if (!data.name?.trim()) {
            alert(t('run.error.nameRequired'));
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

    const handleDisplayIdChange = useCallback((newDisplayId: string) => {
        setDisplayId(newDisplayId);
        setIsDirty(true);
    }, []);

    const ensureTestCaseFromData = async (data: TestData): Promise<string> => {
        if (testCaseId) return testCaseId;
        if (currentTestCaseId) return currentTestCaseId;

        const effectiveProjectId = projectId || projectIdFromTestCase;
        if (!effectiveProjectId) {
            alert(t('run.error.selectProjectUpload'));
            throw new Error(t('run.error.noProjectSelected'));
        }

        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            };

            const usedPlaceholderName = !data.name || data.name.trim() === '';
            const untitledName = t('testCase.untitled');

            const payload: TestData = {
                ...data,
                name: !usedPlaceholderName ? data.name : untitledName,
            };
            if (!payload.url || payload.url.trim() === '') {
                payload.url = 'about:blank';
            }
            const payloadHasSteps = Array.isArray(payload.steps) && payload.steps.length > 0;
            if (!payload.prompt && !payloadHasSteps) {
                payload.prompt = 'Draft';
            }

            const response = await fetch(`/api/projects/${effectiveProjectId}/test-cases`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to create test case');
            }

            const newTestCase = await response.json();
            setCurrentTestCaseId(newTestCase.id);
            refreshFilesRef.current = newTestCase.id;
            window.history.replaceState(null, "", `?testCaseId=${newTestCase.id}&projectId=${effectiveProjectId}`);
            setOriginalName(payload.name || null);
            setOriginalDisplayId(displayId || null);

            if (usedPlaceholderName) {
                setInitialData({ ...data, name: untitledName });
            }

            return newTestCase.id as string;
        } catch (error) {
            console.error('Failed to create test case for upload', error);
            alert(t('run.error.failedCreateTestCaseUpload'));
            throw error;
        }
    };

    if (isAuthLoading) return null;

    return (
        <>
            {(projectId || projectIdFromTestCase) && projectName && (
                <Breadcrumbs items={[
                    { label: projectName, href: `/projects/${projectId || projectIdFromTestCase}` },
                    { label: testCaseId ? t('run.breadcrumb.runTest') : t('run.breadcrumb.newRun') }
                ]} />
            )}

            <input
                type="file"
                ref={fileInputRef}
                onChange={handleImport}
                accept=".md,.markdown,text/markdown"
                className="hidden"
            />

            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold text-gray-900">
                    {testCaseId ? t('run.title.runTest') : t('run.title.startNewRun')}
                </h1>
                <div className="flex items-center gap-2">
                    {['RUNNING', 'QUEUED'].includes(result.status) && (
                        <button
                            onClick={handleStopTest}
                            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                            </svg>
                            {result.status === 'QUEUED' ? t('run.button.quitQueue') : t('run.button.stopTest')}
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
                            initialData={initialData}
                            showNameInput={true}
                            readOnly={['RUNNING', 'QUEUED'].includes(result.status) || !!activeRunId || testCaseStatus === 'RUNNING' || testCaseStatus === 'QUEUED'}
                            onExport={initialData ? handleExport : undefined}
                            onImport={() => fileInputRef.current?.click()}
                            testCaseId={testCaseId || currentTestCaseId || refreshFilesRef.current || undefined}
                            files={testCaseFiles}
                            onFilesChange={handleFilesChange}
                            onEnsureTestCase={ensureTestCaseFromData}
                            onSaveDraft={handleSaveDraft}
                            onDiscard={handleDiscard}
                            isSaving={isSaving}
                            displayId={displayId}
                            onDisplayIdChange={handleDisplayIdChange}
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
    const { t } = useI18n();

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <Suspense fallback={<div>{t('common.loading')}</div>}>
                    <RunPageContent />
                </Suspense>
            </div>
        </main>
    );
}
