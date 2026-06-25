"use client";

import { useState, useEffect, use, useCallback } from "react";
import { useAuth } from "../../../../auth-provider";
import { useRouter } from "next/navigation";
import { ResultViewer } from "@/components/features/run-results";
import { TestForm } from "@/components/features/test-builder";
import { Breadcrumbs } from "@/components/layout";
import { PanelSkeleton } from "@/components/shared";
import { extractListData } from "@/utils/pagination/pagination";
import { formatDateTime } from "@/utils/time/dateFormatter";
import { useI18n } from "@/i18n";
import { parseStoredEvents } from "@/lib/runtime/test-events";
import { resolveSnapshotTestCaseIdentity } from "./snapshot-utils";
import { isSchedulerTriggered } from '@/lib/test-runs/trigger-label';

import { type TestStep, type BrowserConfig, type TargetConfig, type ConfigItem, type TestEvent, type TestStatus, type TestFailureCode, type TestFailureCategory, type LoginFlowPrefixInfo, type RunSessionInfo } from "@/types";

interface TestRun {
    id: string;
    status: TestStatus;
    createdAt: string;
    result: string | null;
    logs: string | null;
    error: string | null;
    configurationSnapshot: string | null;
    testCaseDisplayId?: string | null;
    testCaseName?: string | null;
    errorCode?: TestFailureCode | null;
    errorCategory?: TestFailureCategory | null;
    actionCount?: number | null;
    slackNotifyError?: string | null;
    loginFlowPrefixes?: LoginFlowPrefixInfo[];
    startedAt?: string | null;
    completedAt?: string | null;
    triggeredByEmail?: string | null;
    triggerSource?: string | null;
    instanceId?: string | null;
    instanceType?: string | null;
    instanceName?: string | null;
    runSessionId?: string | null;
    projectId?: string | null;
    events?: TestEvent[];
    files?: Array<{ id: string; filename: string; storedName: string; mimeType: string; size: number; createdAt: string }>;
}

interface TestCase {
    id: string;
    displayId?: string;
    name: string;
    kind?: string;
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
    const [session, setSession] = useState<RunSessionInfo | null>(null);
    const [testCase, setTestCase] = useState<TestCase | null>(null);
    const [projectId, setProjectId] = useState<string>("");
    const [projectName, setProjectName] = useState<string>("");
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
                const projectResponse = await fetch(`/api/projects/${data.projectId}`, { headers });

                if (projectResponse.ok) {
                    const projectData = await projectResponse.json();
                    setProjectName(projectData.name);
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
                if (run.runSessionId && run.projectId) {
                    try {
                        const sessionResponse = await fetch(`/api/projects/${run.projectId}/run-sessions/${run.runSessionId}`, { headers });
                        if (sessionResponse.ok) {
                            setSession(await sessionResponse.json() as RunSessionInfo);
                        }
                    } catch (sessionError) {
                        console.error("Failed to fetch run session", sessionError);
                    }
                }
            } else {
                const historyResponse = await fetch(`/api/test-cases/${id}/history?limit=100&includePayload=1`, { headers });
                if (historyResponse.ok) {
                    const runs = extractListData<TestRun>(await historyResponse.json());
                    const run = runs.find((r) => r.id === runId);
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
            <main className="min-h-screen bg-gray-50 p-8">
                <div className="max-w-7xl mx-auto">
                    <Breadcrumbs items={[{ label: '' }, { label: '' }, { label: '' }]} />
                    <div className="mb-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-end">
                        <div className="skeleton-block h-8 w-48" />
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                        <PanelSkeleton lines={6} />
                        <PanelSkeleton lines={8} />
                    </div>
                </div>
            </main>
        );
    }

    if (!testRun) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-gray-500">{t('runDetail.notFound')}</p>
            </div>
        );
    }

    const events = testRun.events && testRun.events.length > 0
        ? testRun.events
        : parseStoredEvents(testRun.result || testRun.logs);

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
                const snapshotIdentity = resolveSnapshotTestCaseIdentity({
                    displayId: savedConfig.displayId,
                    name: savedConfig.name,
                    fallbackDisplayId: baseConfig?.displayId ?? testRun.testCaseDisplayId ?? undefined,
                    fallbackName: baseConfig?.name ?? testRun.testCaseName ?? undefined,
                });
                const data = {
                    displayId: snapshotIdentity.displayId,
                    name: snapshotIdentity.name,
                    url: savedConfig.url ?? baseConfig?.url ?? '',
                    prompt: savedConfig.prompt ?? baseConfig?.prompt ?? '',
                    steps: savedConfig.steps ?? baseConfig?.steps,
                    browserConfig: savedConfig.browserConfig ?? baseConfig?.browserConfig,
                };

                const projectSnapshotConfigs: ConfigItem[] = [];
                const testCaseSnapshotConfigs: ConfigItem[] = [];
                const allowedConfigTypes = new Set<ConfigItem['type']>(['URL', 'APP_ID', 'VARIABLE', 'RANDOM_STRING', 'FILE']);

                (savedConfig.resolvedConfigurations || []).forEach((config, index) => {
                    if (!allowedConfigTypes.has(config.type as ConfigItem['type'])) {
                        return;
                    }
                    const source = config.source === 'project' ? 'project' : 'test-case';

                    const snapshotConfig: ConfigItem = {
                        id: `snapshot-${index}`,
                        name: config.name,
                        type: config.type as ConfigItem['type'],
                        value: config.value,
                        masked: Boolean((config as { masked?: boolean }).masked),
                        ...(config.filename ? { filename: config.filename } : {}),
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
    const runPageHref = projectId
        ? `/run?testCaseId=${id}&projectId=${projectId}`
        : `/run?testCaseId=${id}`;
    const runByEmail = isSchedulerTriggered(testRun) ? t('run.trigger.scheduler') : (testRun.triggeredByEmail || '-');

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <Breadcrumbs items={[
                    { label: projectName, href: projectId ? `/projects/${projectId}${testCase?.kind === 'LOGIN_FLOW' ? '?tab=login-flows' : ''}` : undefined },
                    { label: testData?.name || testCase?.name || t('runDetail.breadcrumb.testCaseFallback'), href: runPageHref },
                    { label: t('runDetail.breadcrumb.runPrefix', { time: formatDateTime(testRun.createdAt) }) }
                ]} />

                <div className="mb-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-end">
                    <h1 className="text-3xl font-bold text-gray-900">{t('runDetail.title')}</h1>
                    <p className="text-xs text-gray-500 lg:justify-self-end">
                        {t('runDetail.runBy', { email: runByEmail })}
                    </p>
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
                                projectConfigs={snapshotProjectConfigs}
                                testCaseConfigs={snapshotTestCaseConfigs}
                            />
                        )}
                    </div>

                    <div className="h-full min-h-[500px]">
                        <ResultViewer
                            result={{
                                status: testRun.status,
                                events,
                                error: testRun.error || undefined,
                                errorCode: testRun.errorCode ?? undefined,
                                errorCategory: testRun.errorCategory ?? undefined,
                                slackNotifyError: testRun.slackNotifyError ?? undefined,
                                loginFlowPrefixes: testRun.loginFlowPrefixes ?? undefined,
                            }}
                            meta={{
                                runId,
                                testCaseId: id,
                                projectId,
                                projectName,
                                testCaseName: testData?.name || testCase?.name || null,
                                config: testData,
                                files: testRun.files,
                                actionCount: testRun.actionCount ?? undefined,
                                triggeredByEmail: testRun.triggeredByEmail,
                                triggerSource: testRun.triggerSource,
                                instanceName: testRun.instanceName,
                                instanceType: testRun.instanceType,
                                instanceId: testRun.instanceId,
                                startedAt: testRun.startedAt,
                                completedAt: testRun.completedAt,
                                session,
                            }}
                        />
                    </div>
                </div>
            </div>
        </main>
    );
}
