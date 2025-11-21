"use client";

import { useState, useEffect, use } from "react";
import { useAuth } from "../../../auth-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface TestRun {
    id: string;
    status: string;
    createdAt: string;
    result: string;
    error: string | null;
}

export default function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
    const router = useRouter();
    const [testRuns, setTestRuns] = useState<TestRun[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        fetchHistory();
    }, [id]);

    const fetchHistory = async () => {
        try {
            const response = await fetch(`/api/test-cases/${id}/history`);
            if (response.ok) {
                const data = await response.json();
                setTestRuns(data);
            }
        } catch (error) {
            console.error("Failed to fetch history", error);
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

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-5xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </button>
                    <h1 className="text-3xl font-bold text-gray-900">Test History</h1>
                </div>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="grid grid-cols-12 gap-4 p-4 border-b border-gray-200 bg-gray-50 text-sm font-medium text-gray-500">
                        <div className="col-span-3">Status</div>
                        <div className="col-span-5">Date</div>
                        <div className="col-span-4 text-right">Actions</div>
                    </div>

                    {testRuns.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            No history available for this test case.
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {testRuns.map((run) => (
                                <div key={run.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-gray-50 transition-colors">
                                    <div className="col-span-3">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${run.status === 'PASS' ? 'bg-green-100 text-green-800' :
                                                run.status === 'FAIL' ? 'bg-red-100 text-red-800' :
                                                    'bg-yellow-100 text-yellow-800'
                                            }`}>
                                            {run.status}
                                        </span>
                                    </div>
                                    <div className="col-span-5 text-sm text-gray-500">
                                        {new Date(run.createdAt).toLocaleString()}
                                    </div>
                                    <div className="col-span-4 text-right">
                                        <Link
                                            href={`/test-cases/${id}/history/${run.id}`}
                                            className="text-primary hover:text-primary/80 text-sm font-medium"
                                        >
                                            View Details
                                        </Link>
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
