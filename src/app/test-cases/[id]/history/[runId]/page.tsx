"use client";

import { useState, useEffect, use } from "react";
import { useAuth } from "../../../../auth-provider";
import { useRouter } from "next/navigation";
import ResultViewer from "../../../../components/ResultViewer";

interface TestRun {
    id: string;
    status: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL';
    createdAt: string;
    result: string;
    error: string | null;
}

export default function RunDetailPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
    const { id, runId } = use(params);
    const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
    const router = useRouter();
    const [testRun, setTestRun] = useState<TestRun | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        fetchRunDetails();
    }, [runId]);

    const fetchRunDetails = async () => {
        try {
            // We need an API to fetch a single run.
            // I didn't create a specific endpoint for single run, but I can fetch all history and filter.
            // Or better, create a new endpoint.
            // Given the time constraints, fetching all history for the test case and filtering is easier for now,
            // but less efficient.
            // Actually, let's just add the endpoint to be clean.
            // Wait, I can't easily add a new file in the middle of this thought process without breaking flow.
            // I will fetch all history and filter for now. It's a prototype.
            // Actually, I can just use the history endpoint I made: /api/test-cases/[id]/history
            // It returns all runs.
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
        } finally {
            setIsLoading(false);
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

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </button>
                    <h1 className="text-3xl font-bold text-gray-900">
                        Test Run Details
                        <span className="ml-4 text-sm font-normal text-gray-500">
                            {new Date(testRun.createdAt).toLocaleString()}
                        </span>
                    </h1>
                </div>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <ResultViewer result={{ status: testRun.status, events, error: testRun.error || undefined }} />
                </div>
            </div>
        </main>
    );
}
