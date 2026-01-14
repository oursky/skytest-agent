"use client";

import { useState, useEffect, use } from "react";
import { useAuth } from "../../../../auth-provider";
import { useRouter } from "next/navigation";
import ResultViewer from "@/components/ResultViewer";
import TestForm from "@/components/TestForm";
import Breadcrumbs from "@/components/Breadcrumbs";
import { formatDateTime } from "@/utils/dateFormatter";
import { exportToMarkdown } from "@/utils/testCaseMarkdown";

import { TestStep, BrowserConfig } from "@/types";

interface TestRun {
    id: string;
    status: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL';
    createdAt: string;
    result: string;
    error: string | null;
    configurationSnapshot: string | null;
    files?: Array<{ id: string; filename: string; storedName: string; mimeType: string; size: number; createdAt: string }>;
}

interface TestCase {
    id: string;
    name: string;
    url: string;
    prompt: string;
    username?: string;
    password?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig>;
}

export default function RunDetailPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
    const { id, runId } = use(params);
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const [testRun, setTestRun] = useState<TestRun | null>(null);
    const [testCase, setTestCase] = useState<TestCase | null>(null);
    const [projectId, setProjectId] = useState<string>("");
    const [projectName, setProjectName] = useState<string>("");
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

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
    }, [runId, id, isLoggedIn, isAuthLoading]);

    const fetchTestCase = async () => {
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
    };

    const fetchRunDetails = async () => {
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
    };

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
                <p className="text-gray-500">Test run not found.</p>
            </div>
        );
    }

    const events = testRun.result ? JSON.parse(testRun.result) : [];

    const testData = (() => {
        const baseConfig = testCase ? {
            name: testCase.name,
            url: testCase.url,
            prompt: testCase.prompt || '',
            username: testCase.username,
            password: testCase.password,
            steps: testCase.steps,
            browserConfig: testCase.browserConfig,
        } : undefined;

        if (testRun.configurationSnapshot) {
            try {
                const savedConfig = JSON.parse(testRun.configurationSnapshot) as Partial<TestCase>;
                return {
                    name: savedConfig.name ?? baseConfig?.name,
                    url: savedConfig.url ?? baseConfig?.url ?? '',
                    prompt: savedConfig.prompt ?? baseConfig?.prompt ?? '',
                    username: savedConfig.username ?? baseConfig?.username,
                    password: savedConfig.password ?? baseConfig?.password,
                    steps: savedConfig.steps ?? baseConfig?.steps,
                    browserConfig: savedConfig.browserConfig ?? baseConfig?.browserConfig,
                };
            } catch (error) {
                console.error("Failed to parse configuration snapshot", error);
            }
        }

        return baseConfig;
    })();

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <Breadcrumbs items={[
                    { label: projectName, href: projectId ? `/projects/${projectId}` : undefined },
                    { label: testCase?.name || "Test Case", href: `/test-cases/${id}/history` },
                    { label: `Run - ${formatDateTime(testRun.createdAt)}` }
                ]} />

                <div className="flex items-center justify-between mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Test Run Details</h1>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                    <div>
                        {testData && (
                            <TestForm
                                onSubmit={() => { }}
                                isLoading={false}
                                initialData={testData}
                                showNameInput={false}
                                readOnly={true}
                                testCaseId={id}
                                files={testRun?.files}
                                onExport={testData ? () => {
                                    const markdown = exportToMarkdown(testData);
                                    const blob = new Blob([markdown], { type: 'text/markdown' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `${testData.name || 'test-case'}-${formatDateTime(testRun.createdAt)}.md`;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                } : undefined}
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
