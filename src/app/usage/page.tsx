'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../auth-provider';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDateTime } from '@/utils/dateFormatter';
import { useI18n } from '@/i18n';
import Modal from '@/components/Modal';

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

interface AgentApiKey {
    id: string;
    name: string;
    prefix: string;
    lastUsedAt: string | null;
    createdAt: string;
}

export default function UsagePage() {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const { t } = useI18n();

    const [records, setRecords] = useState<UsageRecord[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 10, total: 0, totalPages: 0 });
    const [isLoading, setIsLoading] = useState(true);

    const [apiKeyState, setApiKeyState] = useState<ApiKeyState>({ hasKey: false, maskedKey: null });
    const [newApiKey, setNewApiKey] = useState('');
    const [isSavingKey, setIsSavingKey] = useState(false);
    const [keyError, setKeyError] = useState<string | null>(null);
    const [keySuccess, setKeySuccess] = useState<string | null>(null);
    const [isDeleteApiKeyModalOpen, setIsDeleteApiKeyModalOpen] = useState(false);

    const [agentKeys, setAgentKeys] = useState<AgentApiKey[]>([]);
    const [newKeyName, setNewKeyName] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);
    const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);
    const [keyToRevoke, setKeyToRevoke] = useState<AgentApiKey | null>(null);

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

    const fetchAgentKeys = useCallback(async () => {
        const token = await getAccessToken();
        const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetch('/api/user/api-keys', { headers });
        if (res.ok) {
            const data = await res.json();
            setAgentKeys(data);
        }
    }, [getAccessToken]);

    const handleGenerateAgentKey = async () => {
        if (!newKeyName.trim()) return;
        setIsGenerating(true);
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            };
            const res = await fetch('/api/user/api-keys', {
                method: 'POST',
                headers,
                body: JSON.stringify({ name: newKeyName.trim() })
            });
            if (res.ok) {
                const data = await res.json();
                setGeneratedKey(data.key);
                setNewKeyName('');
                await fetchAgentKeys();
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const handleRevokeAgentKey = async () => {
        if (!keyToRevoke) return;
        const token = await getAccessToken();
        const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetch(`/api/user/api-keys/${keyToRevoke.id}`, { method: 'DELETE', headers });
        if (res.ok) {
            setAgentKeys(prev => prev.filter(k => k.id !== keyToRevoke.id));
        }
        setIsRevokeModalOpen(false);
        setKeyToRevoke(null);
    };

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
                    fetchAgentKeys(),
                    fetchRecords(1, 10)
                ]);
            } catch (error) {
                console.error("Failed to fetch data", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [isLoggedIn, fetchApiKeyStatus, fetchAgentKeys, fetchRecords]);

    const handleSaveApiKey = async () => {
        setKeyError(null);
        setKeySuccess(null);

        if (!newApiKey.trim()) {
            setKeyError(t('usage.apiKey.error.enter'));
            return;
        }

        if (!newApiKey.startsWith('sk-')) {
            setKeyError(t('usage.apiKey.error.prefix'));
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
                setKeySuccess(t('usage.apiKey.success.saved'));
            } else {
                const data = await res.json();
                setKeyError(data.error || t('usage.apiKey.error.saveFailed'));
            }
        } catch {
            setKeyError(t('usage.apiKey.error.saveFailed'));
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
                setKeySuccess(t('usage.apiKey.success.removed'));
            } else {
                setKeyError(t('usage.apiKey.error.removeFailed'));
            }
        } catch {
            setKeyError(t('usage.apiKey.error.removeFailed'));
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
        return <div className="min-h-screen flex items-center justify-center text-gray-500">{t('common.loading')}</div>;
    }

    const url = 'https://openrouter.ai/settings/keys';

    return (
        <main className="min-h-screen bg-gray-50">
            <Modal
                isOpen={isDeleteApiKeyModalOpen}
                onClose={() => setIsDeleteApiKeyModalOpen(false)}
                title={t('usage.apiKey.deleteConfirm.title')}
                onConfirm={handleDeleteApiKey}
                confirmText={t('usage.apiKey.deleteConfirm.confirm')}
                confirmVariant="danger"
            >
                <p className="text-sm text-gray-700">
                    {t('usage.apiKey.deleteConfirm.body')}
                </p>
            </Modal>
            <Modal
                isOpen={isRevokeModalOpen}
                onClose={() => { setIsRevokeModalOpen(false); setKeyToRevoke(null); }}
                title={t('usage.agentKeys.revokeConfirm.title')}
                onConfirm={handleRevokeAgentKey}
                confirmText={t('usage.agentKeys.revokeConfirm.confirm')}
                confirmVariant="danger"
            >
                <p className="text-sm text-gray-700">
                    {t('usage.agentKeys.revokeConfirm.body', { name: keyToRevoke?.name ?? '' })}
                </p>
            </Modal>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

                {/* API Key Section */}
                <h1 className="text-2xl font-bold text-gray-700 mb-4">{t('usage.apiKey.title')}</h1>
                <div className="mb-12">
                    <p className="text-sm text-gray-500 mb-3">
                        {t('usage.apiKey.descPrefix')}{' '}
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 underline"
                        >
                            {url}
                        </a>{' '}
                        {t('usage.apiKey.descSuffix')}
                    </p>
                    {apiKeyState.hasKey ? (
                        <div className="flex items-center gap-3">
                            <code className="text-sm text-gray-600 bg-gray-100 px-3 py-2 rounded">
                                {apiKeyState.maskedKey}
                            </code>
                            <button
                                onClick={() => setIsDeleteApiKeyModalOpen(true)}
                                className="text-sm text-red-600 hover:text-red-800"
                            >
                                {t('usage.apiKey.remove')}
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3">
                            <input
                                type="password"
                                value={newApiKey}
                                onChange={(e) => setNewApiKey(e.target.value)}
                                placeholder={t('usage.apiKey.placeholder')}
                                className="w-80 px-3 py-2 text-sm bg-white border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <button
                                onClick={handleSaveApiKey}
                                disabled={isSavingKey}
                                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                                {isSavingKey ? t('usage.apiKey.saving') : t('usage.apiKey.save')}
                            </button>
                        </div>
                    )}
                    {keyError && <p className="mt-2 text-sm text-red-600">{keyError}</p>}
                    {keySuccess && <p className="mt-2 text-sm text-green-600">{keySuccess}</p>}
                </div>

                {/* Agent API Keys Section */}
                <h2 className="text-2xl font-bold text-gray-700 mb-4">{t('usage.agentKeys.title')}</h2>
                <div className="mb-12">
                    <p className="text-sm text-gray-500 mb-4">{t('usage.agentKeys.description')}</p>

                    {generatedKey && (
                        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <p className="text-sm font-medium text-yellow-800 mb-1">{t('usage.agentKeys.created.title')}</p>
                            <p className="text-xs text-yellow-700 mb-2">{t('usage.agentKeys.created.warning')}</p>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 text-xs text-gray-800 bg-white border border-yellow-300 px-3 py-2 rounded break-all">{generatedKey}</code>
                                <button
                                    onClick={() => { navigator.clipboard.writeText(generatedKey); }}
                                    className="shrink-0 px-3 py-2 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700"
                                >
                                    {t('common.copy')}
                                </button>
                            </div>
                            <button onClick={() => setGeneratedKey(null)} className="mt-2 text-xs text-yellow-700 hover:text-yellow-900 underline">
                                {t('common.hide')}
                            </button>
                        </div>
                    )}

                    <div className="flex items-center gap-3 mb-6">
                        <input
                            type="text"
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleGenerateAgentKey(); }}
                            placeholder={t('usage.agentKeys.name.placeholder')}
                            className="w-72 px-3 py-2 text-sm bg-white border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <button
                            onClick={handleGenerateAgentKey}
                            disabled={isGenerating || !newKeyName.trim()}
                            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                            {t('usage.agentKeys.generate')}
                        </button>
                    </div>

                    {agentKeys.length === 0 ? (
                        <p className="text-sm text-gray-500">{t('usage.agentKeys.noKeys')}</p>
                    ) : (
                        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('usage.agentKeys.name')}</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('usage.agentKeys.prefix')}</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('usage.agentKeys.lastUsed')}</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('usage.table.dateTime')}</th>
                                        <th className="px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {agentKeys.map((key) => (
                                        <tr key={key.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-3 text-sm text-gray-700">{key.name}</td>
                                            <td className="px-4 py-3 text-sm font-mono text-gray-500">{key.prefix}...</td>
                                            <td className="px-4 py-3 text-sm text-gray-500">
                                                {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : t('usage.agentKeys.never')}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-500">{formatDateTime(key.createdAt)}</td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    onClick={() => { setKeyToRevoke(key); setIsRevokeModalOpen(true); }}
                                                    className="text-sm text-red-600 hover:text-red-800"
                                                >
                                                    {t('usage.agentKeys.revoke')}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Usage History Section */}
                <h2 className="text-2xl font-bold text-gray-700 mb-4">{t('usage.history.title')}</h2>
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('usage.table.dateTime')}</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('usage.table.type')}</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('usage.table.description')}</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">{t('usage.table.actionsCount')}</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {records.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                                            {t('usage.noUsageRecords')}
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
                                                    {record.type === 'TEST_RUN' ? t('usage.type.testRun') : record.type}
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
                                ? t('usage.pagination.showing', {
                                    from: ((pagination.page - 1) * pagination.limit) + 1,
                                    to: Math.min(pagination.page * pagination.limit, pagination.total),
                                    total: pagination.total
                                })
                                : t('common.noRecords')
                            }
                        </p>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">{t('common.rows')}</span>
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
                            {t('common.previous')}
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
                            {t('common.next')}
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );
}
