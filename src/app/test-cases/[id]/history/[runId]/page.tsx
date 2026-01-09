"use client";

import { useState, useEffect, use } from "react";
import { useAuth } from "../../../../auth-provider";
import { useRouter } from "next/navigation";
import ResultViewer from "@/components/ResultViewer";
import TestForm from "@/components/TestForm";
import Breadcrumbs from "@/components/Breadcrumbs";
import { formatDateTime } from "@/utils/dateFormatter";

import { TestStep, BrowserConfig } from "@/types";

interface TestRun {
    id: string;
    status: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL';
    createdAt: string;
    result: string;
    error: string | null;
    configurationSnapshot: string | null;
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
    const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
    const router = useRouter();
    const [testRun, setTestRun] = useState<TestRun | null>(null);
    const [testCase, setTestCase] = useState<TestCase | null>(null);
    const [projectId, setProjectId] = useState<string>("");
    const [projectName, setProjectName] = useState<string>("");
    const [isLoading, setIsLoading] = useState(true);
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        const loadData = async () => {
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
    }, [runId, id]);

    const fetchTestCase = async () => {
        try {
            const response = await fetch(`/api/test-cases/${id}`);
            if (response.ok) {
                const data = await response.json();
                setTestCase(data);
                setProjectId(data.projectId);
                const projectResponse = await fetch(`/api/projects/${data.projectId}`);
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
            const response = await fetch(`/api/test-cases/${id}/history`);
            if (response.ok) {
                const data = await response.json();
                const run = data.find((r: TestRun) => r.id === runId);
                if (run) {
                    setTestRun(run);
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
        if (testRun.configurationSnapshot) {
            try {
                const savedConfig = JSON.parse(testRun.configurationSnapshot);
                return {
                    name: savedConfig.name,
                    url: savedConfig.url,
                    prompt: savedConfig.prompt,
                    username: savedConfig.username,
                    password: savedConfig.password,
                    steps: savedConfig.steps,
                    browserConfig: savedConfig.browserConfig,
                };
            } catch (error) {
                console.error("Failed to parse configuration snapshot", error);
            }
        }

        return testCase ? {
            name: testCase.name,
            url: testCase.url,
            prompt: testCase.prompt,
            username: testCase.username,
            password: testCase.password,
            steps: testCase.steps,
            browserConfig: testCase.browserConfig,
        } : undefined;
    })();

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <Breadcrumbs items={[
                    { label: projectName, href: projectId ? `/projects/${projectId}` : undefined },
                    { label: testCase?.name || "Test Case", href: `/test-cases/${id}/history` },
                    { label: `Run - ${formatDateTime(testRun.createdAt)}` }
                ]} />

                <h1 className="text-3xl font-bold text-gray-900 mb-8">Test Run Details</h1>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                    <div>
                        {testData && (
                            <TestForm
                                onSubmit={() => { }}
                                isLoading={false}
                                initialData={testData}
                                showNameInput={false}
                                readOnly={true}
                            />
                        )}
                    </div>

                    <div className="h-full min-h-[500px]">
                        <ResultViewer result={{ status: testRun.status, events, error: testRun.error || undefined }} />
                    </div>
                </div>
            </div>
        </main>
    );
}
