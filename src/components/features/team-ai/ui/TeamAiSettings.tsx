'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { Modal } from '@/components/shared';
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
    const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false);

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
        setIsRemoveConfirmOpen(false);
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
                <h2 className="text-base font-semibold text-gray-900">{t('team.ai.title')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('team.ai.description')}</p>
            </div>

            {state.hasKey ? (
                <div className="flex items-center gap-3">
                    <input
                        type="text"
                        value={state.maskedKey ?? ''}
                        disabled
                        className="w-48 rounded-md border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-500"
                    />
                    {state.canEdit && (
                        <button
                            type="button"
                            onClick={() => setIsRemoveConfirmOpen(true)}
                            className="shrink-0 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                        >
                            {t('team.ai.remove')}
                        </button>
                    )}
                </div>
            ) : state.canEdit ? (
                <div className="flex max-w-lg items-center gap-3">
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={t('team.ai.placeholder')}
                        className="min-w-0 flex-1 rounded-md border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <button
                        type="button"
                        onClick={saveKey}
                        disabled={isSaving}
                        className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                    >
                        {isSaving ? t('team.ai.saving') : t('team.ai.save')}
                    </button>
                </div>
            ) : (
                <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {t('team.ai.notConfigured')}
                </div>
            )}

            <p className="h-5 text-sm">
                {error ? (
                    <span className="text-red-600">{error}</span>
                ) : success ? (
                    <span className="text-emerald-700">{success}</span>
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
