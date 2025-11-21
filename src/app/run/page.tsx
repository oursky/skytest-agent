"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "../auth-provider";
import TestForm from "../components/TestForm";
import ResultViewer from "../components/ResultViewer";

interface TestData {
    url: string;
    username?: string;
    password?: string;
    prompt: string;
    name?: string;
}

interface TestResult {
    status: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL';
    events: any[];
    error?: string;
}

function RunPageContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<TestResult>({
        status: 'IDLE',
        events: [],
    });

    const projectId = searchParams.get("projectId");
    const testCaseId = searchParams.get("testCaseId");
    const [initialData, setInitialData] = useState<TestData | undefined>(undefined);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        if (testCaseId) {
            fetchTestCase(testCaseId);
        }
    }, [testCaseId]);

    const fetchTestCase = async (id: string) => {
        try {
            // We can reuse the project test cases API or create a specific one.
            // For now, let's assume we can get details from the list or add a detail endpoint.
            // Actually, we implemented PUT /api/test-cases/[id] which implies we can also GET it if we add GET method.
            // But wait, we didn't implement GET /api/test-cases/[id].
            // Let's just implement a quick fetch here or assume the user knows what they are doing.
            // To be proper, I should have added GET /api/test-cases/[id].
            // For now, I will skip prefilling if I can't easily get it, OR I can quickly add the GET endpoint.
            // Let's add the GET endpoint in a separate step if needed, but for now let's try to proceed without it 
            // or assume the user will fill it. 
            // WAIT, the requirement says "with the saved info prefilled".
            // I need to implement GET /api/test-cases/[id].

            // I will implement the GET endpoint in the same file as PUT/DELETE in a moment.
            // For now, let's assume it exists.
            const response = await fetch(`/api/test-cases/${id}`);
            if (response.ok) {
                const data = await response.json();
                setInitialData({
                    name: data.name,
                    url: data.url,
                    prompt: data.prompt,
                    username: data.username || "",
                    password: data.password || "",
                });
            }
        } catch (error) {
            console.error("Failed to fetch test case", error);
        }
    };

    const handleRunTest = async (data: TestData) => {
        setIsLoading(true);
        setResult({
            status: 'RUNNING',
            events: [],
        });

        let currentTestCaseId = testCaseId;

        // 1. Create or Update Test Case
        try {
            if (currentTestCaseId) {
                // Update existing test case (if name changed, it might be a new one? Requirement 12 says: 
                // "as long as the 'test case name' is the same, it will be saved to the same test case")
                // Actually requirement 12 says: "Whenever user enters the test run page from a specific test case... as long as the 'test case name' is the same, it will be saved to the same test case"
                // So we update.
                await fetch(`/api/test-cases/${currentTestCaseId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data),
                });
            } else if (projectId && data.name) {
                // Create new test case
                const response = await fetch(`/api/projects/${projectId}/test-cases`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data),
                });
                if (response.ok) {
                    const newTestCase = await response.json();
                    currentTestCaseId = newTestCase.id;
                    // Update URL without reload
                    window.history.replaceState(null, "", `?testCaseId=${currentTestCaseId}`);
                }
            }
        } catch (error) {
            console.error("Failed to save test case", error);
        }

        // 2. Run Test
        try {
            const response = await fetch('/api/run-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            if (!response.body) throw new Error('No response body');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalStatus = 'FAIL';
            let finalEvents: any[] = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const eventData = JSON.parse(line.slice(6));

                            setResult(prev => {
                                const newEvents = [...prev.events];
                                if (eventData.type === 'log' || eventData.type === 'screenshot') {
                                    newEvents.push({ ...eventData, timestamp: Date.now() });
                                } else if (eventData.type === 'status') {
                                    finalStatus = eventData.status;
                                    return { ...prev, status: eventData.status, error: eventData.error };
                                }
                                finalEvents = newEvents;
                                return { ...prev, events: newEvents };
                            });
                        } catch (e) {
                            console.error('Error parsing SSE data:', e);
                        }
                    }
                }
            }

            // 3. Save Test Run Result
            if (currentTestCaseId) {
                await fetch(`/api/test-cases/${currentTestCaseId}/run`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        status: finalStatus,
                        result: finalEvents,
                        error: result.error,
                    }),
                });
            }

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
            setResult(prev => ({ ...prev, status: 'FAIL', error: errorMessage }));

            // Save failed run
            if (currentTestCaseId) {
                await fetch(`/api/test-cases/${currentTestCaseId}/run`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        status: 'FAIL',
                        result: [],
                        error: errorMessage,
                    }),
                });
            }
        } finally {
            setIsLoading(false);
        }
    };

    if (isAuthLoading) return null;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-5 space-y-6">
                <TestForm
                    onSubmit={handleRunTest}
                    isLoading={isLoading}
                    initialData={initialData}
                    showNameInput={true}
                />
            </div>
            <div className="lg:col-span-7 h-full">
                <ResultViewer result={result} />
            </div>
        </div>
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
