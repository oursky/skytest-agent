"use client";

import { useState, useEffect, use, useCallback } from "react";
import { useAuth } from "../../../../auth-provider";
import { useRouter } from "next/navigation";
import ResultViewer from "@/components/ResultViewer";
import TestForm from "@/components/TestForm";
import Breadcrumbs from "@/components/Breadcrumbs";
import { formatDateTime } from "@/utils/dateFormatter";
import { useI18n } from "@/i18n";
import { parseStoredEvents } from "@/lib/test-events";

import { TestStep, BrowserConfig, TargetConfig, ConfigItem } from "@/types";

interface TestRun {
    id: string;
    status: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL' | 'CANCELLED' | 'QUEUED' | 'PREPARING';
    createdAt: string;
    result: string | null;
    logs: string | null;
    error: string | null;
    configurationSnapshot: string | null;
    files?: Array<{ id: string; filename: string; storedName: string; mimeType: string; size: number; createdAt: string }>;
}

interface TestCase {
    id: string;
    displayId?: string;
    name: string;
    url: string;
    prompt: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
}

export default function RunDetailPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
    const { id, runId } = use(params);
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const { t } = useI18n();

    const [testRun, setTestRun] = useState<TestRun | null>(null);
    const [testCase, setTestCase] = useState<TestCase | null>(null);
    const [projectId, setProjectId] = useState<string>("");
    const [projectName, setProjectName] = useState<string>("");
    const [projectConfigs, setProjectConfigs] = useState<ConfigItem[]>([]);
    const [testCaseConfigs, setTestCaseConfigs] = useState<ConfigItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    const fetchTestCase = useCallback(async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};

            const response = await fetch(`/api/test-cases/${id}`, { headers });
            if (response.ok) {
                const data = await response.json();
                setTestCase(data);
                setProjectId(data.projectId);
                const [projectResponse, projectConfigsResponse, testCaseConfigsResponse] = await Promise.all([
                    fetch(`/api/projects/${data.projectId}`, { headers }),
                    fetch(`/api/projects/${data.projectId}/configs`, { headers }),
                    fetch(`/api/test-cases/${id}/configs`, { headers }),
                ]);

                if (projectResponse.ok) {
                    const projectData = await projectResponse.json();
                    setProjectName(projectData.name);
                }
                if (projectConfigsResponse.ok) {
                    setProjectConfigs(await projectConfigsResponse.json());
                } else {
                    setProjectConfigs([]);
                }
                if (testCaseConfigsResponse.ok) {
                    setTestCaseConfigs(await testCaseConfigsResponse.json());
                } else {
                    setTestCaseConfigs([]);
                }
            }
        } catch (error) {
            console.error("Failed to fetch test case", error);
        }
    }, [getAccessToken, id]);

    const fetchRunDetails = useCallback(async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};

            const response = await fetch(`/api/test-runs/${runId}`, { headers });

            if (response.ok) {
                const run = await response.json();
                setTestRun(run);
            } else {
                const historyResponse = await fetch(`/api/test-cases/${id}/history?limit=100`, { headers });
                if (historyResponse.ok) {
                    const result = await historyResponse.json();
                    const runs = result.data || result;
                    const run = runs.find((r: TestRun) => r.id === runId);
                    if (run) setTestRun(run);
                }
            }
        } catch (error) {
            console.error("Failed to fetch run details", error);
        }
    }, [getAccessToken, id, runId]);

    useEffect(() => {
        const loadData = async () => {
            if (!isLoggedIn || isAuthLoading) return;
            setIsLoading(true);
            try {
                await Promise.all([fetchRunDetails(), fetchTestCase()]);
            } catch (error) {
                console.error("Error loading data:", error);
            } finally {
                setIsLoading(false);
            }
        };

        if (runId && id) {
            loadData();
        }
    }, [fetchRunDetails, fetchTestCase, runId, id, isLoggedIn, isAuthLoading]);

    if (isAuthLoading || isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!testRun) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-gray-500">{t('runDetail.notFound')}</p>
            </div>
        );
    }

    const events = parseStoredEvents(testRun.result || testRun.logs);

    const buildExcelBaseName = (testCaseIdentifier?: string, testCaseName?: string): string => {
        const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_');
        const safeId = sanitize((testCaseIdentifier || '').trim());
        const safeName = sanitize((testCaseName || '').trim());
        if (safeId && safeName) return `${safeId}_${safeName}`;
        if (safeName) return safeName;
        if (safeId) return safeId;
        return 'test_case';
    };

    const handleExport = async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-cases/${id}/export`, { headers });
            if (!response.ok) {
                throw new Error('Export request failed');
            }

            const blob = await response.blob();
            const contentDisposition = response.headers.get('Content-Disposition') || '';
            const filenameMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
            const fallbackName = `${buildExcelBaseName(testCase?.displayId, testCase?.name)}.xlsx`;
            const filename = filenameMatch?.[1] || fallbackName;

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to export test case', error);
        }
    };

    const { testData, snapshotProjectConfigs, snapshotTestCaseConfigs } = (() => {
        const baseConfig = testCase ? {
            displayId: testCase.displayId,
            name: testCase.name,
            url: testCase.url,
            prompt: testCase.prompt || '',
            steps: testCase.steps,
            browserConfig: testCase.browserConfig,
        } : undefined;

        if (testRun.configurationSnapshot) {
            try {
                const savedConfig = JSON.parse(testRun.configurationSnapshot) as Partial<TestCase> & {
                    resolvedConfigurations?: Array<{ name: string; type: string; value: string; filename?: string; source: string }>;
                };
                const data = {
                    displayId: savedConfig.displayId ?? baseConfig?.displayId,
                    name: savedConfig.name ?? baseConfig?.name,
                    url: savedConfig.url ?? baseConfig?.url ?? '',
                    prompt: savedConfig.prompt ?? baseConfig?.prompt ?? '',
                    steps: savedConfig.steps ?? baseConfig?.steps,
                    browserConfig: savedConfig.browserConfig ?? baseConfig?.browserConfig,
                };
                const projectFileNameByVariableName = new Map(
                    projectConfigs
                        .filter((config) => config.type === 'FILE')
                        .map((config) => [config.name, config.filename || config.value])
                );
                const testCaseFileNameByVariableName = new Map(
                    testCaseConfigs
                        .filter((config) => config.type === 'FILE')
                        .map((config) => [config.name, config.filename || config.value])
                );

                const projectSnapshotConfigs: ConfigItem[] = [];
                const testCaseSnapshotConfigs: ConfigItem[] = [];

                (savedConfig.resolvedConfigurations || []).forEach((config, index) => {
                    const source = config.source === 'project' ? 'project' : 'test-case';
                    const resolvedFilename = config.type === 'FILE'
                        ? (
                            config.filename
                            || (source === 'project'
                                ? projectFileNameByVariableName.get(config.name)
                                : testCaseFileNameByVariableName.get(config.name))
                        )
                        : undefined;

                    const snapshotConfig: ConfigItem = {
                        id: `snapshot-${index}`,
                        name: config.name,
                        type: config.type as ConfigItem['type'],
                        value: config.value,
                        ...(resolvedFilename ? { filename: resolvedFilename } : {}),
                    };

                    if (source === 'project') {
                        projectSnapshotConfigs.push(snapshotConfig);
                    } else {
                        testCaseSnapshotConfigs.push(snapshotConfig);
                    }
                });

                return {
                    testData: data,
                    snapshotProjectConfigs: projectSnapshotConfigs,
                    snapshotTestCaseConfigs: testCaseSnapshotConfigs,
                };
            } catch (error) {
                console.error("Failed to parse configuration snapshot", error);
            }
        }

        return {
            testData: baseConfig,
            snapshotProjectConfigs: [] as ConfigItem[],
            snapshotTestCaseConfigs: [] as ConfigItem[],
        };
    })();

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <Breadcrumbs items={[
                    { label: projectName, href: projectId ? `/projects/${projectId}` : undefined },
                    { label: testCase?.name || t('runDetail.breadcrumb.testCaseFallback'), href: `/test-cases/${id}/history` },
                    { label: t('runDetail.breadcrumb.runPrefix', { time: formatDateTime(testRun.createdAt) }) }
                ]} />

                <div className="flex items-center justify-between mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">{t('runDetail.title')}</h1>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                    <div className="space-y-4">
                        {testData && (
                            <TestForm
                                onSubmit={() => { }}
                                isLoading={false}
                                initialData={testData}
                                showNameInput={true}
                                readOnly={true}
                                testCaseId={id}
                                displayId={testData.displayId}
                                projectId={projectId}
                                onExport={testData ? handleExport : undefined}
                                projectConfigs={snapshotProjectConfigs}
                                testCaseConfigs={snapshotTestCaseConfigs}
                            />
                        )}
                    </div>

                    <div className="h-full min-h-[500px]">
                        <ResultViewer
                            result={{ status: testRun.status, events, error: testRun.error || undefined }}
                            meta={{
                                runId,
                                testCaseId: id,
                                projectId,
                                projectName,
                                testCaseName: testCase?.name || null,
                                config: testData,
                            }}
                        />
                    </div>
                </div>
            </div>
        </main>
    );
}
