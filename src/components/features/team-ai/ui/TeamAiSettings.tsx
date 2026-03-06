'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';

interface TeamAiSettingsProps {
    teamId: string;
}

interface TeamAiState {
    hasKey: boolean;
    maskedKey: string | null;
    canEdit: boolean;
    updatedAt: string | null;
}

export default function TeamAiSettings({ teamId }: TeamAiSettingsProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [state, setState] = useState<TeamAiState>({ hasKey: false, maskedKey: null, canEdit: false, updatedAt: null });
    const [apiKey, setApiKey] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const loadState = useCallback(async () => {
        const token = await getAccessToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await fetch(`/api/teams/${teamId}/ai-key`, { headers });
        if (!response.ok) {
            setError(t('team.ai.error.load'));
            return;
        }

        const data = await response.json() as TeamAiState;
        setState(data);
        setError(null);
    }, [getAccessToken, teamId, t]);

    useEffect(() => {
        void loadState();
    }, [loadState]);

    const saveKey = async () => {
        setError(null);
        setSuccess(null);

        if (!apiKey.trim()) {
            setError(t('team.ai.error.enter'));
            return;
        }

        if (!apiKey.startsWith('sk-')) {
            setError(t('team.ai.error.prefix'));
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
                body: JSON.stringify({ apiKey })
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({ error: t('team.ai.error.save') }));
                setError(data.error || t('team.ai.error.save'));
                return;
            }

            const data = await response.json() as { maskedKey: string };
            setState((current) => ({ ...current, hasKey: true, maskedKey: data.maskedKey }));
            setApiKey('');
            setSuccess(t('team.ai.success.saved'));
            await loadState();
        } catch {
            setError(t('team.ai.error.save'));
        } finally {
            setIsSaving(false);
        }
    };

    const removeKey = async () => {
        setError(null);
        setSuccess(null);

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
            setSuccess(t('team.ai.success.removed'));
        } catch {
            setError(t('team.ai.error.remove'));
        }
    };

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">{t('team.ai.title')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('team.ai.description')}</p>
            </div>

            {state.hasKey ? (
                <div className="flex items-center justify-between gap-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <div>
                        <div className="text-sm font-medium text-emerald-900">{t('team.ai.configured')}</div>
                        <div className="text-sm text-emerald-800">{state.maskedKey}</div>
                    </div>
                    {state.canEdit && (
                        <button
                            type="button"
                            onClick={removeKey}
                            className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                        >
                            {t('team.ai.remove')}
                        </button>
                    )}
                </div>
            ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {t('team.ai.notConfigured')}
                </div>
            )}

            {state.canEdit ? (
                <div className="space-y-3">
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={t('team.ai.placeholder')}
                        className="w-full rounded-md border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <button
                        type="button"
                        onClick={saveKey}
                        disabled={isSaving}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                    >
                        {isSaving ? t('team.ai.saving') : t('team.ai.save')}
                    </button>
                </div>
            ) : (
                <div className="text-sm text-gray-500">{t('team.ai.readOnly')}</div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-emerald-700">{success}</p>}
        </section>
    );
}
