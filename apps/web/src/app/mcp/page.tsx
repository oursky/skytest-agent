'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../auth-provider';
import { Button, CopyableCodeBlock, DangerTextButton, LoadingSpinner, Modal } from '@/components/shared';
import { useI18n } from '@/i18n';
import { runOnEnterKey } from '@/utils/keyboard/enterKey';
import { formatDateTime } from '@/utils/time/dateFormatter';

interface AgentApiKey {
    id: string;
    name: string;
    prefix: string;
    lastUsedAt: string | null;
    createdAt: string;
}

const SKYTEST_SKILLS_REPO_URL = 'https://github.com/oursky/skytest-agent/tree/main/skills/skytest-skills';

function escapeForSingleQuotedShellArg(value: string): string {
    return value.replace(/'/g, "'\\''");
}

function buildClaudeCodeInstallCommand(endpoint: string, apiKey: string): string {
    const escapedEndpoint = escapeForSingleQuotedShellArg(endpoint);
    const escapedAuthorizationHeader = escapeForSingleQuotedShellArg(`Authorization: Bearer ${apiKey}`);
    return `claude mcp add --scope user --transport http skytest '${escapedEndpoint}' --header '${escapedAuthorizationHeader}'`;
}

function buildCodexInstallCommand(endpoint: string, apiKey: string): string {
    const escapedEndpoint = escapeForSingleQuotedShellArg(endpoint);
    const escapedAuthorizationHeader = escapeForSingleQuotedShellArg(`Authorization: Bearer ${apiKey}`);
    return `codex mcp add skytest -- npx -y mcp-remote@latest '${escapedEndpoint}' --transport http-only --header '${escapedAuthorizationHeader}'`;
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
    const [isGeneratedKeyModalOpen, setIsGeneratedKeyModalOpen] = useState(false);
    const [isGeneratedKeyCopied, setIsGeneratedKeyCopied] = useState(false);
    const [isGeneratedClaudeInstallCopied, setIsGeneratedClaudeInstallCopied] = useState(false);
    const [isGeneratedCodexInstallCopied, setIsGeneratedCodexInstallCopied] = useState(false);
    const [isGeneralConfigCopied, setIsGeneralConfigCopied] = useState(false);
    const [isClaudeInstallCopied, setIsClaudeInstallCopied] = useState(false);
    const [isCodexInstallCopied, setIsCodexInstallCopied] = useState(false);
    const [isSkillInstallPromptCopied, setIsSkillInstallPromptCopied] = useState(false);
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
                setIsGeneratedClaudeInstallCopied(false);
                setIsGeneratedCodexInstallCopied(false);
                setIsGeneratedKeyModalOpen(true);
                setNewKeyName('');
                await fetchAgentKeys();
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const closeGeneratedKeyModal = useCallback(() => {
        setIsGeneratedKeyModalOpen(false);
        setGeneratedKey(null);
        setIsGeneratedKeyCopied(false);
        setIsGeneratedClaudeInstallCopied(false);
        setIsGeneratedCodexInstallCopied(false);
    }, []);

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

    const handleCopyGeneratedClaudeInstallCommand = async () => {
        if (!generatedKey) return;

        try {
            await navigator.clipboard.writeText(buildClaudeCodeInstallCommand(mcpEndpoint, generatedKey));
            setIsGeneratedClaudeInstallCopied(true);
            window.setTimeout(() => setIsGeneratedClaudeInstallCopied(false), 1500);
        } catch (error) {
            console.error('Failed to copy Claude Code install command', error);
        }
    };

    const handleCopyGeneratedCodexInstallCommand = async () => {
        if (!generatedKey) return;

        try {
            await navigator.clipboard.writeText(buildCodexInstallCommand(mcpEndpoint, generatedKey));
            setIsGeneratedCodexInstallCopied(true);
            window.setTimeout(() => setIsGeneratedCodexInstallCopied(false), 1500);
        } catch (error) {
            console.error('Failed to copy Codex install command', error);
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

    const handleCopyGeneralConfig = async () => {
        try {
            await navigator.clipboard.writeText(generalConfigExample);
            setIsGeneralConfigCopied(true);
            window.setTimeout(() => setIsGeneralConfigCopied(false), 1500);
        } catch (error) {
            console.error('Failed to copy general MCP config', error);
        }
    };

    const handleCopyClaudeInstall = async () => {
        try {
            await navigator.clipboard.writeText(claudeCodeInstallExample);
            setIsClaudeInstallCopied(true);
            window.setTimeout(() => setIsClaudeInstallCopied(false), 1500);
        } catch (error) {
            console.error('Failed to copy Claude Code install command', error);
        }
    };

    const handleCopyCodexInstall = async () => {
        try {
            await navigator.clipboard.writeText(codexInstallExample);
            setIsCodexInstallCopied(true);
            window.setTimeout(() => setIsCodexInstallCopied(false), 1500);
        } catch (error) {
            console.error('Failed to copy Codex install command', error);
        }
    };

    const skillInstallPrompt = t('mcp.connection.skillInstall.prompt', { link: SKYTEST_SKILLS_REPO_URL });

    const handleCopyInstallPrompt = async () => {
        try {
            await navigator.clipboard.writeText(skillInstallPrompt);
            setIsSkillInstallPromptCopied(true);
            window.setTimeout(() => setIsSkillInstallPromptCopied(false), 1500);
        } catch (error) {
            console.error('Failed to copy install prompt', error);
        }
    };

    const generalConfigExample = useMemo(() => `{
  "mcpServers": {
    "skytest": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "${mcpEndpoint}",
        "--transport",
        "http-only",
        "--header",
        "Authorization: Bearer <AGENT_API_KEY>"
      ]
    }
  }
}`, [mcpEndpoint]);

    const claudeCodeInstallExample = useMemo(() => (
        `claude mcp add --scope user --transport http skytest '${escapeForSingleQuotedShellArg(mcpEndpoint)}' --header 'Authorization: Bearer <AGENT_API_KEY>'`
    ), [mcpEndpoint]);

    const codexInstallExample = useMemo(() => (
        `codex mcp add skytest -- npx -y mcp-remote@latest '${escapeForSingleQuotedShellArg(mcpEndpoint)}' --transport http-only --header 'Authorization: Bearer <AGENT_API_KEY>'`
    ), [mcpEndpoint]);

    const generatedClaudeInstallCommand = useMemo(() => {
        if (!generatedKey) {
            return '';
        }
        return buildClaudeCodeInstallCommand(mcpEndpoint, generatedKey);
    }, [generatedKey, mcpEndpoint]);

    const generatedCodexInstallCommand = useMemo(() => {
        if (!generatedKey) {
            return '';
        }
        return buildCodexInstallCommand(mcpEndpoint, generatedKey);
    }, [generatedKey, mcpEndpoint]);

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
            <Modal
                isOpen={isGeneratedKeyModalOpen}
                onClose={closeGeneratedKeyModal}
                title={t('usage.agentKeys.created.modal.title')}
                showFooter={false}
                panelClassName="max-w-xl"
            >
                <div className="space-y-5">
                    <div>
                        <p className="text-sm text-gray-500">{t('usage.agentKeys.created.warning')}</p>
                    </div>

                    <div>
                        <p className="text-sm font-medium text-gray-900">{t('usage.agentKeys.created.modal.keyLabel')}</p>
                        <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                            <p className="break-all font-mono text-sm text-gray-900">{generatedKey}</p>
                        </div>
                        <div className="mt-2 flex justify-end">
                            <Button
                                onClick={() => void handleCopyGeneratedKey()}
                                variant="secondary"
                                size="xs"
                                disabled={!generatedKey}
                            >
                                {isGeneratedKeyCopied ? t('common.copied') : t('common.copy')}
                            </Button>
                        </div>
                    </div>

                    <div className="border-t border-gray-100" />

                    <div>
                        <p className="text-sm font-medium text-gray-900">{t('usage.agentKeys.created.modal.claudeInstallTitle')}</p>
                        <p className="mt-1 text-sm text-gray-500">{t('mcp.connection.claudeCode.summary')}</p>
                        <div className="mt-3">
                            <CopyableCodeBlock
                                code={generatedClaudeInstallCommand}
                                copied={isGeneratedClaudeInstallCopied}
                                onCopy={() => void handleCopyGeneratedClaudeInstallCommand()}
                                copyLabel={t('common.copy')}
                                copiedLabel={t('common.copied')}
                            />
                        </div>
                    </div>

                    <div className="border-t border-gray-100 pt-5">
                        <p className="text-sm font-medium text-gray-900">{t('mcp.connection.codex.title')}</p>
                        <p className="mt-1 text-sm text-gray-500">{t('mcp.connection.codex.summary')}</p>
                        <div className="mt-3">
                            <CopyableCodeBlock
                                code={generatedCodexInstallCommand}
                                copied={isGeneratedCodexInstallCopied}
                                onCopy={() => void handleCopyGeneratedCodexInstallCommand()}
                                copyLabel={t('common.copy')}
                                copiedLabel={t('common.copied')}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end pt-4">
                        <Button
                            onClick={closeGeneratedKeyModal}
                            variant="primary"
                            size="sm"
                        >
                            {t('common.done')}
                        </Button>
                    </div>
                </div>
            </Modal>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <h1 className="text-3xl font-bold text-gray-900 mb-4">{t('usage.agentKeys.title')}</h1>
                <div className="mb-8">
                    <p className="text-sm text-gray-500 mb-4">{t('usage.agentKeys.description')}</p>

                    <div className="flex items-center gap-3 mb-6">
                        <input
                            type="text"
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            onKeyDown={(e) => {
                                runOnEnterKey(e, () => {
                                    void handleGenerateAgentKey();
                                });
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
                                                <DangerTextButton
                                                    onClick={() => { setKeyToRevoke(key); setIsRevokeModalOpen(true); }}
                                                    size="sm"
                                                    tone="strong"
                                                >
                                                    {t('usage.agentKeys.revoke')}
                                                </DangerTextButton>
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

                    <div className="space-y-5">
                        <p className="text-sm text-gray-600">{t('mcp.connection.summary')}</p>

                        <div>
                            <p className="text-sm font-medium text-gray-900 mb-1">{t('mcp.connection.general.title')}</p>
                            <p className="text-sm text-gray-500 mb-2">{t('mcp.connection.general.summary')}</p>
                            <CopyableCodeBlock
                                code={generalConfigExample}
                                copied={isGeneralConfigCopied}
                                onCopy={() => void handleCopyGeneralConfig()}
                                copyLabel={t('common.copy')}
                                copiedLabel={t('common.copied')}
                            />
                        </div>

                        <div>
                            <p className="text-sm font-medium text-gray-900 mb-1">{t('mcp.connection.claudeCode.title')}</p>
                            <p className="text-sm text-gray-500 mb-2">{t('mcp.connection.claudeCode.summary')}</p>
                            <CopyableCodeBlock
                                code={claudeCodeInstallExample}
                                copied={isClaudeInstallCopied}
                                onCopy={() => void handleCopyClaudeInstall()}
                                copyLabel={t('common.copy')}
                                copiedLabel={t('common.copied')}
                            />
                        </div>

                        <div>
                            <p className="text-sm font-medium text-gray-900 mb-1">{t('mcp.connection.codex.title')}</p>
                            <p className="text-sm text-gray-500 mb-2">{t('mcp.connection.codex.summary')}</p>
                            <CopyableCodeBlock
                                code={codexInstallExample}
                                copied={isCodexInstallCopied}
                                onCopy={() => void handleCopyCodexInstall()}
                                copyLabel={t('common.copy')}
                                copiedLabel={t('common.copied')}
                            />
                        </div>
                    </div>
                </div>

                <div className="mt-6 bg-white rounded-lg border border-gray-200 p-5 space-y-3">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4">{t('mcp.connection.skillInstall.title')}</h2>
                    <p className="text-sm text-gray-600">{t('mcp.connection.skillInstall.summary')}</p>
                    <CopyableCodeBlock
                        code={skillInstallPrompt}
                        copied={isSkillInstallPromptCopied}
                        onCopy={() => void handleCopyInstallPrompt()}
                        copyLabel={t('common.copy')}
                        copiedLabel={t('common.copied')}
                        preClassName="whitespace-pre-wrap break-words"
                    />
                </div>
            </div>
        </main>
    );
}
