"use client";

import { useState, useEffect, use } from "react";
import { useAuth } from "../../auth-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import Breadcrumbs from "@/components/Breadcrumbs";
import { formatDateTimeCompact } from "@/utils/dateFormatter";

interface TestRun {
    id: string;
    status: string;
    createdAt: string;
}

interface TestCase {
    id: string;
    name: string;
    url: string;
    prompt: string;
    steps: string | null;
    browserConfig: string | null;
    updatedAt: string;
    testRuns: TestRun[];
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
    const router = useRouter();
    const [testCases, setTestCases] = useState<TestCase[]>([]);
    const [projectName, setProjectName] = useState<string>("");
    const [isLoading, setIsLoading] = useState(true);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; testCaseId: string; testCaseName: string }>({ isOpen: false, testCaseId: "", testCaseName: "" });

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        fetchTestCases();
        fetchProjectName();

        const onFocus = () => {
            fetchTestCases();
        };

        window.addEventListener('focus', onFocus);

        const intervalId = setInterval(fetchTestCases, 2000);

        return () => {
            window.removeEventListener('focus', onFocus);
            clearInterval(intervalId);
        };
    }, [id]);

    const fetchProjectName = async () => {
        try {
            const response = await fetch(`/api/projects/${id}`);
            if (response.ok) {
                const data = await response.json();
                setProjectName(data.name);
            }
        } catch (error) {
            console.error("Failed to fetch project name", error);
        }
    };

    const fetchTestCases = async () => {
        try {
            const response = await fetch(`/api/projects/${id}/test-cases`);
            if (response.ok) {
                const data = await response.json();
                setTestCases(data);
            }
        } catch (error) {
            console.error("Failed to fetch test cases", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteTestCase = async () => {
        try {
            const response = await fetch(`/api/test-cases/${deleteModal.testCaseId}`, {
                method: "DELETE",
            });

            if (response.ok) {
                fetchTestCases();
            }
        } catch (error) {
            console.error("Failed to delete test case", error);
        }
    };

    if (isAuthLoading || isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <Modal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, testCaseId: "", testCaseName: "" })}
                title="Delete Test Case"
                onConfirm={handleDeleteTestCase}
                confirmText="Delete"
                confirmVariant="danger"
            >
                <p className="text-gray-700">
                    Are you sure you want to delete <span className="font-semibold">{deleteModal.testCaseName}</span>? This will permanently delete all test history for this test case.
                </p>
            </Modal>

            <div className="max-w-5xl mx-auto">
                <Breadcrumbs items={[{ label: projectName }]} />

                <div className="flex items-center justify-between mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Test Cases</h1>
                    <Link
                        href={`/run?projectId=${id}`}
                        className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors flex items-center gap-2"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Start New Run
                    </Link>
                </div>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="hidden md:grid grid-cols-12 gap-4 p-4 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-500">
                        <div className="col-span-5">Name</div>
                        <div className="col-span-3">Last Run</div>
                        <div className="col-span-2">Updated</div>
                        <div className="col-span-2 text-right">Actions</div>
                    </div>

                    {testCases.length === 0 ? (
                        <div className="p-16 text-center">
                            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">No test cases yet</h3>
                            <p className="text-gray-500 mb-6">Create your first test case by starting a new test run.</p>
                            <Link
                                href={`/run?projectId=${id}`}
                                className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                </svg>
                                Start New Run
                            </Link>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {testCases.map((testCase) => (
                                <div key={testCase.id} className="flex flex-col md:grid md:grid-cols-12 gap-4 p-4 hover:bg-gray-50 transition-colors group">
                                    <div className="md:col-span-5">
                                        <div className="font-medium text-gray-900">{testCase.name}</div>
                                        {(() => {
                                            const hasSteps = testCase.steps && testCase.steps.length > 0;
                                            const hasBrowserConfig = testCase.browserConfig && testCase.browserConfig.length > 0;
                                            const isMultiBrowser = hasSteps || hasBrowserConfig;

                                            if (isMultiBrowser) {
                                                return (
                                                    <div className="text-xs text-gray-500 mt-1">multi-browser</div>
                                                );
                                            } else {
                                                return (
                                                    <div className="text-xs text-gray-500 mt-1">single-browser</div>
                                                );
                                            }
                                        })()}
                                    </div>
                                    <div className="flex items-center gap-4 md:contents">
                                        <div className="md:col-span-3 flex items-center">
                                            {testCase.testRuns[0] ? (
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${testCase.testRuns[0].status === 'PASS' ? 'bg-green-100 text-green-800' :
                                                    testCase.testRuns[0].status === 'FAIL' ? 'bg-red-100 text-red-800' :
                                                        testCase.testRuns[0].status === 'CANCELLED' ? 'bg-gray-100 text-gray-800' :
                                                            testCase.testRuns[0].status === 'RUNNING' ? 'bg-blue-100 text-blue-800' :
                                                                'bg-yellow-100 text-yellow-800' // Queued
                                                    }`}>
                                                    {testCase.testRuns[0].status}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400 text-sm">-</span>
                                            )}
                                        </div>
                                        <div className="md:col-span-2 text-sm text-gray-500 flex items-center">
                                            {formatDateTimeCompact(testCase.updatedAt)}
                                        </div>
                                        <div className="md:col-span-2 flex justify-end gap-2">
                                            {(!testCase.testRuns[0] || !['RUNNING', 'QUEUED'].includes(testCase.testRuns[0].status)) && (
                                                <Link
                                                    href={`/run?testCaseId=${testCase.id}&name=${encodeURIComponent(testCase.name)}`}
                                                    className="p-2 text-gray-500 hover:text-primary hover:bg-primary/10 rounded-md transition-colors inline-flex items-center justify-center"
                                                    title="Run Test"
                                                    aria-label="Run Test"
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                </Link>
                                            )}
                                            {testCase.testRuns[0] && ['RUNNING', 'QUEUED'].includes(testCase.testRuns[0].status) && (
                                                <Link
                                                    href={`/run?runId=${testCase.testRuns[0].id}&testCaseId=${testCase.id}`}
                                                    className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors inline-flex items-center justify-center animate-pulse"
                                                    title="View Running Test"
                                                    aria-label="View Running Test"
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                    </svg>
                                                </Link>
                                            )}
                                            <Link
                                                href={`/test-cases/${testCase.id}/history`}
                                                className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors inline-flex items-center justify-center"
                                                title="View History"
                                                aria-label="View History"
                                            >
                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                            </Link>
                                            <button
                                                onClick={() => setDeleteModal({ isOpen: true, testCaseId: testCase.id, testCaseName: testCase.name })}
                                                disabled={testCase.testRuns[0] && ['RUNNING', 'QUEUED'].includes(testCase.testRuns[0].status)}
                                                className={`p-2 rounded-md transition-colors inline-flex items-center justify-center ${testCase.testRuns[0] && ['RUNNING', 'QUEUED'].includes(testCase.testRuns[0].status)
                                                        ? 'text-gray-300 cursor-not-allowed'
                                                        : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                                                    }`}
                                                title={testCase.testRuns[0] && ['RUNNING', 'QUEUED'].includes(testCase.testRuns[0].status) ? "Cannot delete while test is running or queued" : "Delete Test Case"}
                                                aria-label="Delete Test Case"
                                            >
                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
