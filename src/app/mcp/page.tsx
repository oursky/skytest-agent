'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../auth-provider';
import { Button, CopyableCodeBlock, LoadingSpinner, Modal } from '@/components/shared';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/utils/dateFormatter';

interface AgentApiKey {
    id: string;
    name: string;
    prefix: string;
    lastUsedAt: string | null;
    createdAt: string;
}

const SKYTEST_SKILLS_REPO_URL = 'https://github.com/oursky/skytest-agent/tree/main/skills/skytest-skills';

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
    const [isInstallCommandCopied, setIsInstallCommandCopied] = useState(false);
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

    const skillInstallPrompt = t('mcp.connection.skillInstall.prompt', { link: SKYTEST_SKILLS_REPO_URL });

    const handleCopyInstallPrompt = async () => {
        try {
            await navigator.clipboard.writeText(skillInstallPrompt);
            setIsInstallCommandCopied(true);
            window.setTimeout(() => setIsInstallCommandCopied(false), 1500);
        } catch (error) {
            console.error('Failed to copy install prompt', error);
        }
    };

    const configExample = useMemo(() => `{
  "mcpServers": {
    "skytest": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "${mcpEndpoint}",
        "--transport",
        "http-only",
        "--allow-http",
        "--header",
        "Authorization:\${SKYTEST_AUTH_HEADER}"
      ],
      "env": {
        "SKYTEST_AUTH_HEADER": "Bearer <AGENT_API_KEY>"
      }
    }
  }
}`, [mcpEndpoint]);

    if (isAuthLoading || isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center text-gray-500">
                <LoadingSpinner size={24} />
            </div>
        );
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
                <h1 className="text-3xl font-bold text-gray-900 mb-4">{t('usage.agentKeys.title')}</h1>
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
                                <Button
                                    onClick={handleCopyGeneratedKey}
                                    size="xs"
                                    className="shrink-0 border-0 bg-yellow-600 text-white hover:bg-yellow-700"
                                >
                                    {isGeneratedKeyCopied ? t('usage.agentKeys.created.copied') : t('common.copy')}
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-3 mb-6">
                        <input
                            type="text"
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void handleGenerateAgentKey();
                                }
                            }}
                            placeholder={t('usage.agentKeys.name.placeholder')}
                            className="w-72 px-3 py-2 text-sm bg-white border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <Button
                            onClick={handleGenerateAgentKey}
                            disabled={isGenerating || !newKeyName.trim()}
                            variant="primary"
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {t('usage.agentKeys.generate')}
                        </Button>
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
                                                <Button
                                                    onClick={() => { setKeyToRevoke(key); setIsRevokeModalOpen(true); }}
                                                    variant="ghost"
                                                    size="xs"
                                                    className="h-auto p-0 text-sm text-red-600 hover:bg-transparent hover:text-red-800"
                                                >
                                                    {t('usage.agentKeys.revoke')}
                                                </Button>
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

                    <div className="space-y-3 mb-5">
                        <p className="text-sm text-gray-600">{t('mcp.connection.aiAgent.summary')}</p>
                        <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                            <li>{t('mcp.connection.aiAgent.step1')}</li>
                            <li>{t('mcp.connection.aiAgent.step2')}</li>
                            <li>{t('mcp.connection.aiAgent.step3')}</li>
                        </ol>
                    </div>

                    <p className="text-sm text-gray-500 mb-2">{t('mcp.connection.aiAgent.configExample')}</p>
                    <CopyableCodeBlock
                        code={configExample}
                        copied={isConfigCopied}
                        onCopy={() => void handleCopyConfigExample()}
                        copyLabel={t('common.copy')}
                        copiedLabel={t('usage.agentKeys.created.copied')}
                    />

                </div>

                <div className="mt-6 bg-white rounded-lg border border-gray-200 p-5 space-y-3">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4">{t('mcp.connection.skillInstall.title')}</h2>
                    <p className="text-sm text-gray-600">{t('mcp.connection.skillInstall.summary')}</p>
                    <CopyableCodeBlock
                        code={skillInstallPrompt}
                        copied={isInstallCommandCopied}
                        onCopy={() => void handleCopyInstallPrompt()}
                        copyLabel={t('common.copy')}
                        copiedLabel={t('usage.agentKeys.created.copied')}
                        preClassName="whitespace-pre-wrap break-words"
                    />
                </div>
            </div>
        </main>
    );
}
