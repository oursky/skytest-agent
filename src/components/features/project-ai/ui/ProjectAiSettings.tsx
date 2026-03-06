'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';

interface ProjectAiSettingsProps {
    projectId: string;
}

interface ProjectAiState {
    hasKey: boolean;
    maskedKey: string | null;
    canEdit: boolean;
}

export default function ProjectAiSettings({ projectId }: ProjectAiSettingsProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [state, setState] = useState<ProjectAiState>({ hasKey: false, maskedKey: null, canEdit: false });
    const [apiKey, setApiKey] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const fetchState = async () => {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
            const response = await fetch(`/api/projects/${projectId}/ai-key`, { headers });
            if (!response.ok) {
                setError(t('project.ai.error.load'));
                return;
            }

            const data = await response.json() as ProjectAiState;
            setState(data);
        };

        void fetchState();
    }, [getAccessToken, projectId, t]);

    const saveKey = async () => {
        setError(null);
        setSuccess(null);

        if (!apiKey.trim()) {
            setError(t('project.ai.error.enter'));
            return;
        }

        if (!apiKey.startsWith('sk-')) {
            setError(t('project.ai.error.prefix'));
            return;
        }

        setIsSaving(true);
        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/projects/${projectId}/ai-key`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ apiKey })
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({ error: t('project.ai.error.save') }));
                setError(data.error || t('project.ai.error.save'));
                return;
            }

            const data = await response.json() as { maskedKey: string };
            setState((current) => ({ ...current, hasKey: true, maskedKey: data.maskedKey }));
            setApiKey('');
            setSuccess(t('project.ai.success.saved'));
        } catch {
            setError(t('project.ai.error.save'));
        } finally {
            setIsSaving(false);
        }
    };

    const removeKey = async () => {
        setError(null);
        setSuccess(null);

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/projects/${projectId}/ai-key`, {
                method: 'DELETE',
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            });

            if (!response.ok) {
                setError(t('project.ai.error.remove'));
                return;
            }

            setState((current) => ({ ...current, hasKey: false, maskedKey: null }));
            setSuccess(t('project.ai.success.removed'));
        } catch {
            setError(t('project.ai.error.remove'));
        }
    };

    return (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">{t('project.ai.title')}</h2>
                <p className="text-sm text-gray-500 mt-1">{t('project.ai.description')}</p>
            </div>

            {state.hasKey ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-4">
                    <div>
                        <div className="text-sm font-medium text-emerald-900">{t('project.ai.configured')}</div>
                        <div className="text-sm text-emerald-800">{state.maskedKey}</div>
                    </div>
                    {state.canEdit && (
                        <button
                            type="button"
                            onClick={removeKey}
                            className="px-3 py-2 text-sm font-medium text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50"
                        >
                            {t('project.ai.remove')}
                        </button>
                    )}
                </div>
            ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {t('project.ai.notConfigured')}
                </div>
            )}

            {state.canEdit ? (
                <div className="space-y-3">
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={t('project.ai.placeholder')}
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <button
                        type="button"
                        onClick={saveKey}
                        disabled={isSaving}
                        className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50"
                    >
                        {isSaving ? t('project.ai.saving') : t('project.ai.save')}
                    </button>
                </div>
            ) : (
                <div className="text-sm text-gray-500">{t('project.ai.readOnly')}</div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-emerald-700">{success}</p>}
        </section>
    );
}
