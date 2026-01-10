"use client";

import { useState, useEffect, Suspense, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../auth-provider";
import TestForm from "@/components/TestForm";
import ResultViewer from "@/components/ResultViewer";
import Breadcrumbs from "@/components/Breadcrumbs";
import { TestStep, BrowserConfig, TestEvent } from "@/types";

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
    const { user, isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
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
    const [originalMode, setOriginalMode] = useState<'simple' | 'builder' | null>(null);

    const [activeRunId, setActiveRunId] = useState<string | null>(null);

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
        if (currentRunId && activeRunId && currentRunId === activeRunId) {
        }
    }, [currentRunId, activeRunId]);

    useEffect(() => {
        return () => {
            if (eventSource) {
                eventSource.close();
            }
        };
    }, [eventSource]);

    useEffect(() => {
        if (testCaseId) {
            fetchTestCase(testCaseId);
        } else if (testCaseName) {
            setInitialData({ name: testCaseName, url: '', prompt: '' });
        }
    }, [testCaseId, testCaseName]);

    const fetchTestCase = async (id: string) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-cases/${id}`, { headers });
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
                setOriginalMode(mode);
                setProjectIdFromTestCase(data.projectId);
                fetchProjectName(data.projectId);

                if (data.testRuns && data.testRuns.length > 0) {
                    const latestRun = data.testRuns[0];
                    if (['RUNNING', 'QUEUED'].includes(latestRun.status)) {
                        setActiveRunId(latestRun.id);
                        if (!currentRunId) {
                        }
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
                        // We avoid overwriting everything if we just wanted status, 
                        // but here we seem to be reloading the form state.
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

    const connectToRun = async (runId: string) => {
        if (eventSource) eventSource.close();

        // Don't eagerly set to RUNNING, as it might be QUEUED.
        // If we are connecting, it means we want to see updates.
        // We should let the event stream or initial fetch determine the status.
        // But to avoid "IDLE" flash, we can set it to QUEUED if it's currently IDLE, 
        // or just keep previous status if valid.
        // Better: Fetch status first or assume QUEUED until proven RUNNING?
        // Actually, preventing reset to 'RUNNING' is key.
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
                return { ...prev, error: 'Connection lost. Please refresh to check status.' };
            });
        };

        setEventSource(es);
    };

    const handleStopTest = async () => {
        if (currentRunId) {
            setIsLoading(true);
            try {
                const response = await fetch(`/api/test-runs/${currentRunId}/cancel`, {
                    method: 'POST'
                });
                if (!response.ok) throw new Error('Failed to stop test');

                setResult(prev => ({ ...prev, status: 'CANCELLED', error: 'Test stopped by user' }));
                setActiveRunId(null);
            } catch (error) {
                console.error('Failed to stop test', error);
                alert('Failed to stop test');
            } finally {
                setIsLoading(false);
            }
        }
    };

    const handleRunTest = async (data: TestData) => {
        setIsLoading(true);
        setResult({
            status: 'IDLE',
            events: [],
        });

        let activeTestCaseId = testCaseId;
        const currentMode = (data.steps?.length || data.browserConfig) ? 'builder' : 'simple';

        try {
            const hasSteps = data.steps && data.steps.length > 0;
            const hasBrowserConfig = data.browserConfig && Object.keys(data.browserConfig).length > 0;

            const nameChanged = originalName && data.name && data.name !== originalName;
            const modeChanged = originalMode && currentMode !== originalMode;
            const shouldCreateNew = nameChanged || modeChanged;

            const token = await getAccessToken();
            const headers: HeadersInit = {
                "Content-Type": "application/json",
                ...(token ? { "Authorization": `Bearer ${token}` } : {})
            };

            if (activeTestCaseId && !shouldCreateNew) {
                await fetch(`/api/test-cases/${activeTestCaseId}`, {
                    method: "PUT",
                    headers,
                    body: JSON.stringify(data),
                });
            } else if ((activeTestCaseId && shouldCreateNew) || (!activeTestCaseId && projectId && data.name)) {
                const effectiveProjectId = projectId || projectIdFromTestCase;
                if (effectiveProjectId) {
                    const response = await fetch(`/api/projects/${effectiveProjectId}/test-cases`, {
                        method: "POST",
                        headers,
                        body: JSON.stringify(data),
                    });
                    if (response.ok) {
                        const newTestCase = await response.json();
                        activeTestCaseId = newTestCase.id;
                        setCurrentTestCaseId(activeTestCaseId);
                        window.history.replaceState(null, "", `?testCaseId=${activeTestCaseId}&projectId=${effectiveProjectId}`);
                        setOriginalName(data.name || null);
                        setOriginalMode(currentMode);
                    } else {
                        throw new Error('Failed to create test case');
                    }
                }
            }
        } catch (error) {
            console.error("Failed to save test case", error);
            setResult({ status: 'FAIL', events: [], error: 'Failed to save test case' });
            setIsLoading(false);
            return;
        }

        if (!activeTestCaseId) {
            setResult({ status: 'FAIL', events: [], error: 'Please select or create a test case first.' });
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
    };




    if (isAuthLoading) return null;

    return (
        <>
            {(projectId || projectIdFromTestCase) && projectName && (
                <Breadcrumbs items={[
                    { label: projectName, href: `/projects/${projectId || projectIdFromTestCase}` },
                    { label: testCaseId ? 'Run Test' : 'New Run' }
                ]} />
            )}

            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold text-gray-900">
                    {testCaseId ? 'Run Test' : 'Start New Run'}
                </h1>
                <div className="flex items-center gap-4">
                    {['RUNNING', 'QUEUED'].includes(result.status) && (
                        <button
                            onClick={handleStopTest}
                            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                            </svg>
                            {result.status === 'QUEUED' ? 'Quit Queue' : 'Stop Test'}
                        </button>
                    )}
                </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                <div className="space-y-6">
                    {activeRunId && activeRunId !== currentRunId ? (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
                            <h3 className="text-lg font-semibold text-blue-900 mb-2">Test in Progress</h3>
                            <p className="text-blue-700 mb-4">A test is currently running for this test case.</p>
                            <button
                                onClick={() => {
                                    window.history.pushState(null, "", `?runId=${activeRunId}&testCaseId=${testCaseId}&projectId=${projectId || projectIdFromTestCase}`);
                                    fetchTestRun(activeRunId);
                                    connectToRun(activeRunId);
                                }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                            >
                                View Running Test
                            </button>
                        </div>
                    ) : (
                        <TestForm
                            onSubmit={handleRunTest}
                            isLoading={isLoading || (!!activeRunId && activeRunId === currentRunId)}
                            initialData={initialData}
                            showNameInput={true}
                            readOnly={!!activeRunId}
                        />
                    )}
                </div>
                <div className="h-full">
                    <ResultViewer result={result} />
                </div>
            </div>
        </>
    );
}

export default function RunPage() {
    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <Suspense fallback={<div>Loading...</div>}>
                    <RunPageContent />
                </Suspense>
            </div>
        </main>
    );
}
