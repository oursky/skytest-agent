'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { Button, LoadingSpinner, Modal } from '@/components/shared';
import { useI18n } from '@/i18n';

interface TeamAiSettingsProps {
    teamId: string;
}

interface TeamAiState {
    hasKey: boolean;
    maskedKey: string | null;
    updatedAt: string | null;
    providerConfig: {
        provider: 'openrouter' | 'openai-compatible';
        baseUrl: string | null;
        mainModel: string | null;
        planningModel: string | null;
        insightModel: string | null;
        temperature: number | null;
    };
}

export default function TeamAiSettings({ teamId }: TeamAiSettingsProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [state, setState] = useState<TeamAiState>({
        hasKey: false,
        maskedKey: null,
        updatedAt: null,
        providerConfig: {
            provider: 'openrouter',
            baseUrl: null,
            mainModel: null,
            planningModel: null,
            insightModel: null,
            temperature: null,
        },
    });
    const [isLoading, setIsLoading] = useState(true);
    const [apiKey, setApiKey] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false);
    const [provider, setProvider] = useState<'openrouter' | 'openai-compatible'>('openrouter');
    const [baseUrl, setBaseUrl] = useState('');
    const [mainModel, setMainModel] = useState('');
    const [planningModel, setPlanningModel] = useState('');
    const [insightModel, setInsightModel] = useState('');
    const [temperature, setTemperature] = useState('');

    const loadState = useCallback(async () => {
        try {
            setIsLoading(true);
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
            const response = await fetch(`/api/teams/${teamId}/ai-key`, { headers });
            if (!response.ok) {
                setError(t('team.ai.error.load'));
                return;
            }

            const data = await response.json() as TeamAiState;
            setState(data);
            setProvider(data.providerConfig.provider);
            setBaseUrl(data.providerConfig.baseUrl ?? '');
            setMainModel(data.providerConfig.mainModel ?? '');
            setPlanningModel(data.providerConfig.planningModel ?? '');
            setInsightModel(data.providerConfig.insightModel ?? '');
            setTemperature(
                typeof data.providerConfig.temperature === 'number'
                    ? String(data.providerConfig.temperature)
                    : ''
            );
            setError(null);
        } finally {
            setIsLoading(false);
        }
    }, [getAccessToken, teamId, t]);

    useEffect(() => {
        void loadState();
    }, [loadState]);

    const saveKey = async () => {
        setError(null);

        if (!apiKey.trim()) {
            setError(t('team.ai.error.enter'));
            return;
        }

        setIsSaving(true);
        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${teamId}/ai-key`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    apiKey,
                    providerConfig: {
                        provider,
                        baseUrl,
                        mainModel,
                        planningModel,
                        insightModel,
                        temperature: temperature.trim() ? Number.parseFloat(temperature) : null,
                    },
                })
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({ error: t('team.ai.error.save') }));
                setError(data.error || t('team.ai.error.save'));
                return;
            }

            const data = await response.json() as { maskedKey: string };
            setState((current) => ({ ...current, hasKey: true, maskedKey: data.maskedKey }));
            setApiKey('');
            await loadState();
        } catch {
            setError(t('team.ai.error.save'));
        } finally {
            setIsSaving(false);
        }
    };

    const removeKey = async () => {
        setIsRemoveConfirmOpen(false);
        setError(null);

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${teamId}/ai-key`, {
                method: 'DELETE',
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            });

            if (!response.ok) {
                setError(t('team.ai.error.remove'));
                return;
            }

            setState((current) => ({ ...current, hasKey: false, maskedKey: null, updatedAt: null }));
        } catch {
            setError(t('team.ai.error.remove'));
        }
    };

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <div>
                <h2 className="text-base font-semibold text-gray-900">{t('team.ai.title')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('team.ai.description')}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.provider.label')}</span>
                    <select
                        value={provider}
                        onChange={(event) => setProvider(event.target.value as 'openrouter' | 'openai-compatible')}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                        <option value="openrouter">{t('team.ai.provider.option.openrouter')}</option>
                        <option value="openai-compatible">{t('team.ai.provider.option.openaiCompatible')}</option>
                    </select>
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.baseUrl')}</span>
                    <input
                        type="text"
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                        placeholder="https://openrouter.ai/api/v1"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.mainModel')}</span>
                    <input
                        type="text"
                        value={mainModel}
                        onChange={(event) => setMainModel(event.target.value)}
                        placeholder="google/gemini-3.1-flash-lite-preview"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.planningModel')}</span>
                    <input
                        type="text"
                        value={planningModel}
                        onChange={(event) => setPlanningModel(event.target.value)}
                        placeholder="qwen/qwen3.5-27b"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.insightModel')}</span>
                    <input
                        type="text"
                        value={insightModel}
                        onChange={(event) => setInsightModel(event.target.value)}
                        placeholder="qwen/qwen3.5-27b"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.temperature')}</span>
                    <input
                        type="number"
                        step="0.1"
                        value={temperature}
                        onChange={(event) => setTemperature(event.target.value)}
                        placeholder="0.2"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </label>
            </div>

            {isLoading ? (
                <div className="flex items-center gap-3 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-600">
                    <LoadingSpinner size={16} />
                    <span>{t('common.loading')}</span>
                </div>
            ) : state.hasKey ? (
                <div className="flex items-center gap-3">
                    <input
                        type="text"
                        value={state.maskedKey ?? ''}
                        disabled
                        className="w-48 rounded-md border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-500"
                    />
                    <Button
                        onClick={() => setIsRemoveConfirmOpen(true)}
                        variant="secondary"
                        size="sm"
                        className="shrink-0 border-red-200 text-red-700 hover:bg-red-50"
                    >
                        {t('team.ai.remove')}
                    </Button>
                </div>
            ) : (
                <div className="flex max-w-lg items-center gap-3">
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void saveKey();
                            }
                        }}
                        placeholder={t('team.ai.placeholder')}
                        className="min-w-0 flex-1 rounded-md border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <Button
                        onClick={saveKey}
                        disabled={isSaving}
                        variant="primary"
                        size="sm"
                        className="shrink-0"
                    >
                        {isSaving ? t('team.ai.saving') : t('team.ai.save')}
                    </Button>
                </div>
            )}

            <p className="h-5 text-sm">
                {error ? (
                    <span className="text-red-600">{error}</span>
                ) : null}
            </p>

            <Modal
                isOpen={isRemoveConfirmOpen}
                onClose={() => setIsRemoveConfirmOpen(false)}
                title={t('team.ai.remove')}
                onConfirm={() => void removeKey()}
                confirmText={t('team.ai.removeConfirm.confirm')}
                confirmVariant="danger"
            >
                <p className="text-sm text-gray-600">{t('team.ai.removeConfirm.message')}</p>
            </Modal>
        </section>
    );
}
