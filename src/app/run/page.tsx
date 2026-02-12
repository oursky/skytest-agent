"use client";

import { useState, useEffect, Suspense, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "../auth-provider";
import TestForm from "@/components/TestForm";
import ResultViewer from "@/components/ResultViewer";
import Breadcrumbs from "@/components/Breadcrumbs";
import { TestStep, BrowserConfig, TestEvent, TestCaseFile, ConfigItem } from "@/types";
import { exportToExcelArrayBuffer, parseTestCaseExcel } from "@/utils/testCaseExcel";
import { useI18n } from "@/i18n";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";

interface TestData {
    url: string;
    username?: string;
    password?: string;
    prompt: string;
    name?: string;
    displayId?: string;
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

    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [testCaseFiles, setTestCaseFiles] = useState<TestCaseFile[]>([]);
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [displayId, setDisplayId] = useState<string>('');
    const [testCaseStatus, setTestCaseStatus] = useState<string | null>(null);
    const [projectConfigs, setProjectConfigs] = useState<ConfigItem[]>([]);
    const [testCaseConfigs, setTestCaseConfigs] = useState<ConfigItem[]>([]);
    const refreshFilesRef = useRef<string | null>(null);
    useUnsavedChanges(isDirty, t('run.unsavedChangesWarning'));

    const downloadBlob = (blob: Blob, filename: string) => {
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
    };

    const extractFileName = (headerValue: string | null, fallbackName: string): string => {
        if (!headerValue) return fallbackName;
        const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match?.[1]) {
            return decodeURIComponent(utf8Match[1]);
        }
        const quotedMatch = headerValue.match(/filename="([^"]+)"/i);
        if (quotedMatch?.[1]) {
            return quotedMatch[1];
        }
        const plainMatch = headerValue.match(/filename=([^;]+)/i);
        if (plainMatch?.[1]) {
            return plainMatch[1].trim();
        }
        return fallbackName;
    };

    const buildExcelBaseName = (testCaseIdentifier?: string, testCaseName?: string): string => {
        const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_');
        const safeId = sanitize((testCaseIdentifier || '').trim());
        const safeName = sanitize((testCaseName || '').trim());
        if (safeId && safeName) return `${safeId}_${safeName}`;
        if (safeName) return safeName;
        if (safeId) return safeId;
        return 'test_case';
    };

    const isExcelFilename = (filename: string): boolean => {
        const normalized = filename.toLowerCase();
        return normalized.endsWith('.xlsx') || normalized.endsWith('.xls');
    };

    const isSupportedVariableConfig = (
        config: ConfigItem
    ): config is ConfigItem & { type: 'URL' | 'VARIABLE' | 'SECRET' | 'RANDOM_STRING' | 'FILE' } => {
        return config.type === 'URL' || config.type === 'VARIABLE' || config.type === 'SECRET' || config.type === 'RANDOM_STRING' || config.type === 'FILE';
    };

    const importVariablesToTestCase = async (
        variables: Array<{ name: string; type: 'URL' | 'VARIABLE' | 'SECRET' | 'RANDOM_STRING'; value: string }>,
        sourceData: TestData
    ): Promise<string | null> => {
        if (variables.length === 0) {
            return testCaseId || currentTestCaseId || refreshFilesRef.current || null;
        }

        let targetTestCaseId = testCaseId || currentTestCaseId || refreshFilesRef.current || null;
        if (!targetTestCaseId) {
            targetTestCaseId = await ensureTestCaseFromData(sourceData);
        }
        if (!targetTestCaseId) return null;

        const token = await getAccessToken();
        const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
        const jsonHeaders: HeadersInit = {
            'Content-Type': 'application/json',
            ...headers
        };

        const existingResponse = await fetch(`/api/test-cases/${targetTestCaseId}/configs`, { headers });
        const existingConfigs: ConfigItem[] = existingResponse.ok ? await existingResponse.json() : [];
        const existingByName = new Map(existingConfigs.map((config) => [config.name, config]));

        for (const variable of variables) {
            const existing = existingByName.get(variable.name);
            try {
                if (!existing) {
                    await fetch(`/api/test-cases/${targetTestCaseId}/configs`, {
                        method: 'POST',
                        headers: jsonHeaders,
                        body: JSON.stringify(variable),
                    });
                } else {
                    await fetch(`/api/test-cases/${targetTestCaseId}/configs/${existing.id}`, {
                        method: 'PUT',
                        headers: jsonHeaders,
                        body: JSON.stringify(variable),
                    });
                }
            } catch {
                // silently skip failed variables
            }
        }

        await fetchTestCaseConfigs(targetTestCaseId);
        return targetTestCaseId;
    };

    const handleExport = async (data: TestData) => {
        const exportData: TestData = { ...data };

        const exportTestCaseId = testCaseId || currentTestCaseId || refreshFilesRef.current;
        const hasAttachedFilesInState = testCaseFiles.length > 0
            || projectConfigs.some((config) => config.type === 'FILE')
            || testCaseConfigs.some((config) => config.type === 'FILE');

        if (exportTestCaseId && (!isDirty || hasAttachedFilesInState)) {
            try {
                const token = await getAccessToken();
                const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
                const response = await fetch(`/api/test-cases/${exportTestCaseId}/export`, { headers });
                if (!response.ok) {
                    throw new Error('Export request failed');
                }

                const blob = await response.blob();
                const filename = extractFileName(
                    response.headers.get('Content-Disposition'),
                    `${buildExcelBaseName(exportData.displayId, exportData.name)}.xlsx`
                );
                downloadBlob(blob, filename);
                return;
            } catch (error) {
                console.error('Failed to export from API, fallback to local Excel export', error);
            }
        }

        let exportProjectConfigs = projectConfigs;
        let exportTestCaseConfigs = testCaseConfigs;
        const exportProjectId = projectId || projectIdFromTestCase;

        if (exportProjectId || exportTestCaseId) {
            try {
                const token = await getAccessToken();
                const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};

                const fetchConfigs = async (url: string): Promise<ConfigItem[] | null> => {
                    const response = await fetch(url, { headers });
                    if (!response.ok) {
                        return null;
                    }
                    return await response.json() as ConfigItem[];
                };

                const [projectConfigsWithSecrets, testCaseConfigsWithSecrets] = await Promise.all([
                    exportProjectId
                        ? fetchConfigs(`/api/projects/${exportProjectId}/configs?includeSecretValues=true`)
                        : Promise.resolve(null),
                    exportTestCaseId
                        ? fetchConfigs(`/api/test-cases/${exportTestCaseId}/configs?includeSecretValues=true`)
                        : Promise.resolve(null),
                ]);

                if (projectConfigsWithSecrets) {
                    exportProjectConfigs = projectConfigsWithSecrets;
                }
                if (testCaseConfigsWithSecrets) {
                    exportTestCaseConfigs = testCaseConfigsWithSecrets;
                }
            } catch (error) {
                console.error('Failed to fetch secret config values for export', error);
            }
        }

        const excelArrayBuffer = exportToExcelArrayBuffer({
            name: exportData.name,
            testCaseId: exportData.displayId || undefined,
            steps: exportData.steps,
            browserConfig: exportData.browserConfig,
            projectVariables: exportProjectConfigs
                .filter(isSupportedVariableConfig)
                .map((config) => ({
                    name: config.name,
                    type: config.type,
                    value: config.type === 'FILE' ? (config.filename || config.value) : config.value,
                })),
            testCaseVariables: exportTestCaseConfigs
                .filter(isSupportedVariableConfig)
                .map((config) => ({
                    name: config.name,
                    type: config.type,
                    value: config.type === 'FILE' ? (config.filename || config.value) : config.value,
                })),
            files: testCaseFiles.map((file) => ({
                filename: file.filename,
                mimeType: file.mimeType,
                size: file.size,
            })),
        });

        const blob = new Blob([excelArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        downloadBlob(blob, `${buildExcelBaseName(exportData.displayId, exportData.name)}.xlsx`);
    };

    const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            if (!isExcelFilename(file.name)) return;

            const fileBuffer = await file.arrayBuffer();
            const { data } = parseTestCaseExcel(fileBuffer);

            setInitialData(data.testData);
            if (data.testCaseId) {
                setDisplayId(data.testCaseId);
            }
            setIsDirty(true);

            await importVariablesToTestCase(
                [...data.projectVariables, ...data.testCaseVariables].filter((variable): variable is { name: string; type: 'URL' | 'VARIABLE' | 'SECRET' | 'RANDOM_STRING'; value: string } => (
                    variable.type === 'URL' || variable.type === 'VARIABLE' || variable.type === 'SECRET' || variable.type === 'RANDOM_STRING'
                )),
                data.testData
            );
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

    useEffect(() => {
        if (projectId) fetchProjectName(projectId);
    }, [projectId]);

    useEffect(() => {
        if (projectIdFromTestCase && !projectId) fetchProjectName(projectIdFromTestCase);
    }, [projectIdFromTestCase, projectId]);

    useEffect(() => {
        if (!runId || isAuthLoading || !isLoggedIn) return;
        fetchTestRun(runId);
        connectToRun(runId);
    }, [runId, isAuthLoading, isLoggedIn]);

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

                setInitialData({
                    name: data.name,
                    url: data.url,
                    prompt: data.prompt,
                    username: data.username || "",
                    password: data.password || "",
                    steps: data.steps,
                    browserConfig: data.browserConfig,
                });

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

    const fetchProjectConfigs = useCallback(async (projId: string) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/projects/${projId}/configs`, { headers });
            if (response.ok) {
                setProjectConfigs(await response.json());
            }
        } catch (error) {
            console.error("Failed to fetch project configs", error);
        }
    }, [getAccessToken]);

    const fetchTestCaseConfigs = useCallback(async (tcId: string) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-cases/${tcId}/configs`, { headers });
            if (response.ok) {
                setTestCaseConfigs(await response.json());
            }
        } catch (error) {
            console.error("Failed to fetch test case configs", error);
        }
    }, [getAccessToken]);

    useEffect(() => {
        const effectiveProjectId = projectId || projectIdFromTestCase;
        if (effectiveProjectId) fetchProjectConfigs(effectiveProjectId);
    }, [projectId, projectIdFromTestCase, fetchProjectConfigs]);

    useEffect(() => {
        const tcId = testCaseId || currentTestCaseId;
        if (tcId) fetchTestCaseConfigs(tcId);
    }, [testCaseId, currentTestCaseId, fetchTestCaseConfigs]);

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
        if (!token) {
            setResult(prev => ({
                ...prev,
                status: 'FAIL',
                error: t('run.error.connectionLost')
            }));
            setIsLoading(false);
            return;
        }

        const url = `/api/test-runs/${runId}/events?token=${token}`;
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
        const finalDisplayId = data.displayId ?? displayId;

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
    }, [testCaseId, currentTestCaseId, projectId, projectIdFromTestCase, displayId, getAccessToken]);

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

    const isRunInProgress =
        isLoading
        || ['RUNNING', 'QUEUED'].includes(result.status)
        || !!activeRunId
        || testCaseStatus === 'RUNNING'
        || testCaseStatus === 'QUEUED';

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
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
