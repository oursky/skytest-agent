"use client";

import { useState, useEffect, use } from "react";
import { useAuth } from "../../../auth-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import Breadcrumbs from "@/components/Breadcrumbs";
import { formatDateTime } from "@/utils/dateFormatter";

interface TestRun {
    id: string;
    status: string;
    createdAt: string;
    result: string;
    error: string | null;
}

export default function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const [testRuns, setTestRuns] = useState<TestRun[]>([]);
    const [testCaseName, setTestCaseName] = useState<string>("");
    const [projectId, setProjectId] = useState<string>("");
    const [projectName, setProjectName] = useState<string>("");
    const [isLoading, setIsLoading] = useState(true);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; runId: string; status?: string }>({ isOpen: false, runId: "", status: "" });

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
                await Promise.all([fetchHistory(), fetchTestCaseInfo()]);
            } catch (error) {
                console.error("Error loading data:", error);
            } finally {
                setIsLoading(false);
            }
        };

        if (id) {
            loadData();
        }
    }, [id, isLoggedIn, isAuthLoading]);

    const fetchTestCaseInfo = async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};

            const response = await fetch(`/api/test-cases/${id}`, { headers });
            if (response.ok) {
                const data = await response.json();
                setTestCaseName(data.name);
                setProjectId(data.projectId);
                const projectResponse = await fetch(`/api/projects/${data.projectId}`, { headers });
                if (projectResponse.ok) {
                    const projectData = await projectResponse.json();
                    setProjectName(projectData.name);
                }
            }
        } catch (error) {
            console.error("Failed to fetch test case info", error);
        }
    };

    const fetchHistory = async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-cases/${id}/history`, { headers });
            if (response.ok) {
                const data = await response.json();
                setTestRuns(data);
            }
        } catch (error) {
            console.error("Failed to fetch history", error);
        }
    };

    const handleDeleteRun = async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-runs/${deleteModal.runId}`, {
                method: "DELETE",
                headers
            });

            if (response.ok) {
                fetchHistory();
                setDeleteModal({ isOpen: false, runId: "", status: "" });
            }
        } catch (error) {
            console.error("Failed to delete test run", error);
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
                onClose={() => setDeleteModal({ isOpen: false, runId: "", status: "" })}
                title={['RUNNING', 'QUEUED'].includes(deleteModal.status || '') ? "Stop & Delete Test Run" : "Delete Test Run"}
                onConfirm={handleDeleteRun}
                confirmText={['RUNNING', 'QUEUED'].includes(deleteModal.status || '') ? "Stop & Delete" : "Delete"}
                confirmVariant="danger"
            >
                <div className="text-gray-700">
                    {['RUNNING', 'QUEUED'].includes(deleteModal.status || '') ? (
                        <div className="space-y-2">
                            <p className="font-semibold text-red-600">Warning: This test is currently running or queued.</p>
                            <p>Deleting it will <strong>STOP</strong> the execution immediately and remove all records.</p>
                        </div>
                    ) : (
                        <p>Are you sure you want to delete this test run? This action cannot be undone.</p>
                    )}
                </div>
            </Modal>

            <div className="max-w-5xl mx-auto">
                <Breadcrumbs items={[
                    { label: projectName, href: projectId ? `/projects/${projectId}` : undefined },
                    { label: testCaseName }
                ]} />

                <h1 className="text-3xl font-bold text-gray-900 mb-8">Test History</h1>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="grid grid-cols-12 gap-4 p-4 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-500">
                        <div className="col-span-3">Status</div>
                        <div className="col-span-5">Date</div>
                        <div className="col-span-4 text-right">Actions</div>
                    </div>

                    {testRuns.length === 0 ? (
                        <div className="p-16 text-center">
                            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">No test history</h3>
                            <p className="text-gray-500">This test case hasn't been run yet. Run the test to see results here.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {testRuns.map((run) => (
                                <div key={run.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-gray-50 transition-colors">
                                    <div className="col-span-3">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${run.status === 'PASS' ? 'bg-green-100 text-green-800' :
                                            run.status === 'FAIL' ? 'bg-red-100 text-red-800' :
                                                run.status === 'CANCELLED' ? 'bg-gray-100 text-gray-800' :
                                                    run.status === 'RUNNING' ? 'bg-blue-100 text-blue-800' :
                                                        'bg-yellow-100 text-yellow-800'
                                            }`}>
                                            {run.status}
                                        </span>
                                    </div>
                                    <div className="col-span-5 text-sm text-gray-500">
                                        {formatDateTime(run.createdAt)}
                                    </div>
                                    <div className="col-span-4 flex justify-end gap-2">
                                        {['RUNNING', 'QUEUED'].includes(run.status) ? (
                                            <Link
                                                href={`/run?runId=${run.id}&testCaseId=${id}`}
                                                className="px-3 py-1.5 text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 text-sm font-medium rounded transition-colors flex items-center gap-1 animate-pulse"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </svg>
                                                View Live
                                            </Link>
                                        ) : (
                                            <Link
                                                href={`/test-cases/${id}/history/${run.id}`}
                                                className="px-3 py-1.5 text-primary hover:text-primary/80 text-sm font-medium hover:bg-blue-50 rounded transition-colors"
                                            >
                                                View Details
                                            </Link>
                                        )}
                                        <button
                                            onClick={() => setDeleteModal({ isOpen: true, runId: run.id, status: run.status })}
                                            disabled={['RUNNING', 'QUEUED'].includes(run.status)}
                                            className={`p-2 transition-colors ${['RUNNING', 'QUEUED'].includes(run.status)
                                                ? 'text-gray-300 cursor-not-allowed'
                                                : 'text-gray-400 hover:text-red-600'
                                                }`}
                                            title={['RUNNING', 'QUEUED'].includes(run.status) ? "Cannot delete while running or queued" : "Delete Run"}
                                            aria-label="Delete Run"
                                        >
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
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
