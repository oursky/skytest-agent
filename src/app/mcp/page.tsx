'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../auth-provider';
import Modal from '@/components/Modal';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/utils/dateFormatter';

interface AgentApiKey {
    id: string;
    name: string;
    prefix: string;
    lastUsedAt: string | null;
    createdAt: string;
}

export default function McpPage() {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const { t } = useI18n();

    const [isLoading, setIsLoading] = useState(true);
    const [agentKeys, setAgentKeys] = useState<AgentApiKey[]>([]);
    const [newKeyName, setNewKeyName] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);
    const [isGeneratedKeyCopied, setIsGeneratedKeyCopied] = useState(false);
    const [isConfigCopied, setIsConfigCopied] = useState(false);
    const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);
    const [keyToRevoke, setKeyToRevoke] = useState<AgentApiKey | null>(null);
    const [mcpEndpoint, setMcpEndpoint] = useState('/api/mcp');

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push('/');
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        setMcpEndpoint(`${window.location.origin}/api/mcp`);
    }, []);

    const fetchAgentKeys = useCallback(async () => {
        const token = await getAccessToken();
        const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetch('/api/user/api-keys', { headers });
        if (res.ok) {
            const data = await res.json();
            setAgentKeys(data);
        }
    }, [getAccessToken]);

    useEffect(() => {
        const fetchData = async () => {
            if (!isLoggedIn) return;
            setIsLoading(true);
            try {
                await fetchAgentKeys();
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [isLoggedIn, fetchAgentKeys]);

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
                setIsGeneratedKeyCopied(false);
                setNewKeyName('');
                await fetchAgentKeys();
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopyGeneratedKey = async () => {
        if (!generatedKey) return;

        try {
            await navigator.clipboard.writeText(generatedKey);
            setIsGeneratedKeyCopied(true);
            window.setTimeout(() => setIsGeneratedKeyCopied(false), 1500);
        } catch (error) {
            console.error('Failed to copy generated key', error);
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

    const handleCopyConfigExample = async () => {
        try {
            await navigator.clipboard.writeText(configExample);
            setIsConfigCopied(true);
            window.setTimeout(() => setIsConfigCopied(false), 1500);
        } catch (error) {
            console.error('Failed to copy config example', error);
        }
    };

    const configExample = useMemo(() => `{
  "mcpServers": {
    "skytest": {
      "transport": "streamable-http",
      "url": "${mcpEndpoint}",
      "headers": {
        "Authorization": "Bearer <AGENT_API_KEY>"
      }
    }
  }
}`, [mcpEndpoint]);

    if (isAuthLoading || isLoading) {
        return <div className="min-h-screen flex items-center justify-center text-gray-500">{t('common.loading')}</div>;
    }

    return (
        <main className="min-h-screen bg-gray-50">
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
                <h2 className="text-2xl font-bold text-gray-700 mb-4">{t('usage.agentKeys.title')}</h2>
                <div className="mb-8">
                    <p className="text-sm text-gray-500 mb-4">{t('usage.agentKeys.description')}</p>

                    {generatedKey && (
                        <div className="relative mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <button
                                onClick={() => { setGeneratedKey(null); setIsGeneratedKeyCopied(false); }}
                                aria-label={t('common.hide')}
                                className="absolute top-2 right-2 h-6 w-6 flex items-center justify-center text-sm text-yellow-700 hover:text-yellow-900"
                            >
                                X
                            </button>
                            <p className="text-sm font-medium text-yellow-800 mb-1">{t('usage.agentKeys.created.title')}</p>
                            <p className="text-xs text-yellow-700 mb-2">{t('usage.agentKeys.created.warning')}</p>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 text-xs text-gray-800 bg-white border border-yellow-300 px-3 py-2 rounded break-all">{generatedKey}</code>
                                <button
                                    onClick={handleCopyGeneratedKey}
                                    className="shrink-0 px-3 py-2 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700"
                                >
                                    {isGeneratedKeyCopied ? t('usage.agentKeys.created.copied') : t('common.copy')}
                                </button>
                            </div>
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

                <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4">{t('mcp.connection.title')}</h2>
                    <dl className="space-y-3">
                        <div>
                            <dt className="text-xs font-semibold uppercase text-gray-500">{t('mcp.connection.endpoint')}</dt>
                            <dd className="text-sm text-gray-700 font-mono break-all">{mcpEndpoint}</dd>
                        </div>
                        <div>
                            <dt className="text-xs font-semibold uppercase text-gray-500">{t('mcp.connection.protocol')}</dt>
                            <dd className="text-sm text-gray-700">{t('mcp.connection.protocolValue')}</dd>
                        </div>
                        <div>
                            <dt className="text-xs font-semibold uppercase text-gray-500">{t('mcp.connection.auth')}</dt>
                            <dd className="text-sm text-gray-700">{t('mcp.connection.authValue')}</dd>
                        </div>
                    </dl>

                    <p className="text-sm text-gray-500 mt-4 mb-2">{t('mcp.connection.configExample')}</p>
                    <div className="relative">
                        <button
                            onClick={handleCopyConfigExample}
                            aria-label={isConfigCopied ? t('usage.agentKeys.created.copied') : t('common.copy')}
                            title={isConfigCopied ? t('usage.agentKeys.created.copied') : t('common.copy')}
                            className="absolute top-2 right-2 z-10 h-7 w-7 flex items-center justify-center text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-100"
                        >
                            {isConfigCopied ? (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                    <rect x="9" y="9" width="10" height="10" rx="2" strokeWidth="2" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 15H6a2 2 0 01-2-2V6a2 2 0 012-2h7a2 2 0 012 2v1" />
                                </svg>
                            )}
                        </button>
                        <pre className="bg-gray-50 text-gray-800 text-xs rounded border border-gray-200 p-3 overflow-x-auto">
                            <code>{configExample}</code>
                        </pre>
                    </div>
                </div>
            </div>
        </main>
    );
}
