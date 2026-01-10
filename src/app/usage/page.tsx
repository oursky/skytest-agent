'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../auth-provider';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDateTime } from '@/utils/dateFormatter';

interface TestRunInfo {
    id: string;
    testCase: {
        id: string;
        name: string;
        projectId: string;
    } | null;
}

interface UsageRecord {
    id: string;
    type: string;
    description: string | null;
    aiActions: number;
    testRunId: string | null;
    testRun: TestRunInfo | null;
    createdAt: string;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

interface ApiKeyState {
    hasKey: boolean;
    maskedKey: string | null;
}

export default function UsagePage() {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const [records, setRecords] = useState<UsageRecord[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 10, total: 0, totalPages: 0 });
    const [isLoading, setIsLoading] = useState(true);

    const [apiKeyState, setApiKeyState] = useState<ApiKeyState>({ hasKey: false, maskedKey: null });
    const [newApiKey, setNewApiKey] = useState('');
    const [isSavingKey, setIsSavingKey] = useState(false);
    const [keyError, setKeyError] = useState<string | null>(null);
    const [keySuccess, setKeySuccess] = useState<string | null>(null);

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push('/');
        }
    }, [isAuthLoading, isLoggedIn, router]);

    const fetchApiKeyStatus = useCallback(async () => {
        const token = await getAccessToken();
        const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};

        const res = await fetch('/api/user/api-key', { headers });
        if (res.ok) {
            const data = await res.json();
            setApiKeyState(data);
        }
    }, [getAccessToken]);

    const fetchRecords = useCallback(async (page: number, limit: number) => {
        const token = await getAccessToken();
        const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });

        const res = await fetch(`/api/user/usage?${params}`, { headers });
        if (res.ok) {
            const data = await res.json();
            setRecords(data.records);
            setPagination(data.pagination);
        }
    }, [getAccessToken]);

    useEffect(() => {
        const fetchData = async () => {
            if (!isLoggedIn) return;
            setIsLoading(true);
            try {
                await Promise.all([
                    fetchApiKeyStatus(),
                    fetchRecords(1, 10)
                ]);
            } catch (error) {
                console.error("Failed to fetch data", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [isLoggedIn, fetchApiKeyStatus, fetchRecords]);

    const handleSaveApiKey = async () => {
        setKeyError(null);
        setKeySuccess(null);

        if (!newApiKey.trim()) {
            setKeyError('Please enter an API key');
            return;
        }

        if (!newApiKey.startsWith('sk-')) {
            setKeyError('API key should start with "sk-"');
            return;
        }

        setIsSavingKey(true);
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            };

            const res = await fetch('/api/user/api-key', {
                method: 'POST',
                headers,
                body: JSON.stringify({ apiKey: newApiKey })
            });

            if (res.ok) {
                const data = await res.json();
                setApiKeyState({ hasKey: true, maskedKey: data.maskedKey });
                setNewApiKey('');
                setKeySuccess('API key saved successfully');
            } else {
                const data = await res.json();
                setKeyError(data.error || 'Failed to save API key');
            }
        } catch (error) {
            setKeyError('Failed to save API key');
        } finally {
            setIsSavingKey(false);
        }
    };

    const handleDeleteApiKey = async () => {
        setKeyError(null);
        setKeySuccess(null);

        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};

            const res = await fetch('/api/user/api-key', {
                method: 'DELETE',
                headers
            });

            if (res.ok) {
                setApiKeyState({ hasKey: false, maskedKey: null });
                setKeySuccess('API key removed');
            } else {
                setKeyError('Failed to remove API key');
            }
        } catch (error) {
            setKeyError('Failed to remove API key');
        }
    };

    const handlePageChange = (newPage: number) => {
        fetchRecords(newPage, pagination.limit);
    };

    const handleLimitChange = (newLimit: number) => {
        fetchRecords(1, newLimit);
    };

    const getTestRunLink = (record: UsageRecord): string | null => {
        if (!record.testRun?.testCase) return null;
        return `/test-cases/${record.testRun.testCase.id}/history/${record.testRun.id}`;
    };

    if (isAuthLoading || isLoading) {
        return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>;
    }

    return (
        <main className="min-h-screen bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

                {/* API Key Section */}
                <h1 className="text-2xl font-bold text-gray-700 mb-4">API Key</h1>
                <div className="mb-12">
                    <p className="text-sm text-gray-500 mb-3">
                        Enter your OpenRouter API Key here. Visit{' '}
                        <a
                            href="https://openrouter.ai/settings/keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 underline"
                        >
                            https://openrouter.ai/settings/keys
                        </a>
                        {' '}to get a key.
                    </p>
                    {apiKeyState.hasKey ? (
                        <div className="flex items-center gap-3">
                            <code className="text-sm text-gray-600 bg-gray-100 px-3 py-2 rounded">
                                {apiKeyState.maskedKey}
                            </code>
                            <button
                                onClick={handleDeleteApiKey}
                                className="text-sm text-red-600 hover:text-red-800"
                            >
                                Remove
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3">
                            <input
                                type="password"
                                value={newApiKey}
                                onChange={(e) => setNewApiKey(e.target.value)}
                                placeholder="sk-or-v1-..."
                                className="w-80 px-3 py-2 text-sm bg-white border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <button
                                onClick={handleSaveApiKey}
                                disabled={isSavingKey}
                                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                                {isSavingKey ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    )}
                    {keyError && <p className="mt-2 text-sm text-red-600">{keyError}</p>}
                    {keySuccess && <p className="mt-2 text-sm text-green-600">{keySuccess}</p>}
                </div>

                {/* Usage History Section */}
                <h2 className="text-2xl font-bold text-gray-700 mb-4">Usage History</h2>
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date Time</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions Count</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {records.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                                            No usage records found.
                                        </td>
                                    </tr>
                                ) : (
                                    records.map((record) => {
                                        const link = getTestRunLink(record);
                                        return (
                                            <tr key={record.id} className="hover:bg-gray-50">
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                    {formatDateTime(record.createdAt)}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                    {record.type === 'TEST_RUN' ? 'Test Run' : record.type}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-gray-500">
                                                    {link ? (
                                                        <Link
                                                            href={link}
                                                            className="text-blue-600 hover:text-blue-800 underline"
                                                        >
                                                            {record.description || '-'}
                                                        </Link>
                                                    ) : (
                                                        record.description || '-'
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500">
                                                    {record.aiActions}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Pagination */}
                <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <p className="text-sm text-gray-500">
                            {pagination.total > 0
                                ? `Showing ${((pagination.page - 1) * pagination.limit) + 1} to ${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total}`
                                : 'No records'
                            }
                        </p>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">Rows:</span>
                            <select
                                value={pagination.limit}
                                onChange={(e) => handleLimitChange(Number(e.target.value))}
                                className="px-2 py-1 text-sm text-gray-500 border border-gray-300 rounded focus:outline-none"
                            >
                                <option value={10}>10</option>
                                <option value={20}>20</option>
                                <option value={50}>50</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => handlePageChange(pagination.page - 1)}
                            disabled={pagination.page === 1 || pagination.totalPages === 0}
                            className="px-3 py-1.5 text-sm text-gray-500 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Previous
                        </button>
                        {pagination.totalPages > 0 && (
                            <div className="flex items-center gap-1">
                                {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                                    let pageNum: number;
                                    if (pagination.totalPages <= 5) {
                                        pageNum = i + 1;
                                    } else if (pagination.page <= 3) {
                                        pageNum = i + 1;
                                    } else if (pagination.page >= pagination.totalPages - 2) {
                                        pageNum = pagination.totalPages - 4 + i;
                                    } else {
                                        pageNum = pagination.page - 2 + i;
                                    }
                                    return (
                                        <button
                                            key={pageNum}
                                            onClick={() => handlePageChange(pageNum)}
                                            className={`px-3 py-1.5 text-sm rounded ${
                                                pagination.page === pageNum
                                                    ? 'bg-gray-500 text-white'
                                                    : 'text-gray-500 border border-gray-300 hover:bg-gray-50'
                                            }`}
                                        >
                                            {pageNum}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        <button
                            onClick={() => handlePageChange(pagination.page + 1)}
                            disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
                            className="px-3 py-1.5 text-sm text-gray-500 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );
}
