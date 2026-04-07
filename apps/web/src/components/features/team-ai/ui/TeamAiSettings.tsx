'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { Button, CustomSelect, LoadingSpinner, Modal } from '@/components/shared';
import { useI18n } from '@/i18n';
import { VALID_MODEL_FAMILIES } from '@/lib/runtime/midscene-env';

interface TeamAiSettingsProps {
    teamId: string;
}

type TeamAiProvider = 'openrouter' | 'openai-compatible';

type ProviderFieldErrorKey =
    | 'apiKey'
    | 'baseUrl'
    | 'mainModel'
    | 'mainModelFamily'
    | 'planningModel'
    | 'planningModelFamily'
    | 'insightModel'
    | 'insightModelFamily'
    | 'temperature';

interface TeamAiState {
    hasKey: boolean;
    maskedKey: string | null;
    updatedAt: string | null;
    providerConfig: {
        provider: TeamAiProvider;
        baseUrl: string | null;
        mainModel: string | null;
        mainModelFamily: string | null;
        planningModel: string | null;
        planningModelFamily: string | null;
        insightModel: string | null;
        insightModelFamily: string | null;
        temperature: number | null;
    };
}

const TEAM_AI_DEFAULTS = {
    provider: 'openrouter' as TeamAiProvider,
    baseUrl: 'https://openrouter.ai/api/v1',
    mainModel: 'google/gemini-3.1-flash-lite-preview',
    mainModelFamily: 'gemini',
    planningModel: 'qwen/qwen3.5-27b',
    planningModelFamily: 'qwen3.5',
    insightModel: 'qwen/qwen3.5-27b',
    insightModelFamily: 'qwen3.5',
    temperature: '0.2',
};

const MODEL_FAMILY_OPTIONS = VALID_MODEL_FAMILIES.map((family) => ({
    value: family,
    label: family === 'gpt-5' ? 'gpt-5 (OpenAI-compatible providers)' : family,
}));

function toFieldErrorMap(input: unknown): Partial<Record<ProviderFieldErrorKey, string>> {
    if (!input || typeof input !== 'object') {
        return {};
    }

    const result: Partial<Record<ProviderFieldErrorKey, string>> = {};
    const validKeys: ProviderFieldErrorKey[] = [
        'apiKey',
        'baseUrl',
        'mainModel',
        'mainModelFamily',
        'planningModel',
        'planningModelFamily',
        'insightModel',
        'insightModelFamily',
        'temperature',
    ];

    for (const key of validKeys) {
        const value = (input as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            result[key] = value;
        }
    }

    return result;
}

export default function TeamAiSettings({ teamId }: TeamAiSettingsProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [state, setState] = useState<TeamAiState>({
        hasKey: false,
        maskedKey: null,
        updatedAt: null,
        providerConfig: {
            provider: TEAM_AI_DEFAULTS.provider,
            baseUrl: TEAM_AI_DEFAULTS.baseUrl,
            mainModel: TEAM_AI_DEFAULTS.mainModel,
            mainModelFamily: TEAM_AI_DEFAULTS.mainModelFamily,
            planningModel: TEAM_AI_DEFAULTS.planningModel,
            planningModelFamily: TEAM_AI_DEFAULTS.planningModelFamily,
            insightModel: TEAM_AI_DEFAULTS.insightModel,
            insightModelFamily: TEAM_AI_DEFAULTS.insightModelFamily,
            temperature: Number.parseFloat(TEAM_AI_DEFAULTS.temperature),
        },
    });
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProviderFieldErrorKey, string>>>({});

    const [apiKey, setApiKey] = useState('');
    const [provider, setProvider] = useState<TeamAiProvider>(TEAM_AI_DEFAULTS.provider);
    const [baseUrl, setBaseUrl] = useState(TEAM_AI_DEFAULTS.baseUrl);
    const [mainModel, setMainModel] = useState(TEAM_AI_DEFAULTS.mainModel);
    const [mainModelFamily, setMainModelFamily] = useState(TEAM_AI_DEFAULTS.mainModelFamily);
    const [planningModel, setPlanningModel] = useState(TEAM_AI_DEFAULTS.planningModel);
    const [planningModelFamily, setPlanningModelFamily] = useState(TEAM_AI_DEFAULTS.planningModelFamily);
    const [insightModel, setInsightModel] = useState(TEAM_AI_DEFAULTS.insightModel);
    const [insightModelFamily, setInsightModelFamily] = useState(TEAM_AI_DEFAULTS.insightModelFamily);
    const [temperature, setTemperature] = useState(TEAM_AI_DEFAULTS.temperature);

    const clearFieldError = (key: ProviderFieldErrorKey) => {
        setFieldErrors((current) => {
            if (!current[key]) {
                return current;
            }
            const next = { ...current };
            delete next[key];
            return next;
        });
    };

    const resetToDefaults = () => {
        setProvider(TEAM_AI_DEFAULTS.provider);
        setBaseUrl(TEAM_AI_DEFAULTS.baseUrl);
        setMainModel(TEAM_AI_DEFAULTS.mainModel);
        setMainModelFamily(TEAM_AI_DEFAULTS.mainModelFamily);
        setPlanningModel(TEAM_AI_DEFAULTS.planningModel);
        setPlanningModelFamily(TEAM_AI_DEFAULTS.planningModelFamily);
        setInsightModel(TEAM_AI_DEFAULTS.insightModel);
        setInsightModelFamily(TEAM_AI_DEFAULTS.insightModelFamily);
        setTemperature(TEAM_AI_DEFAULTS.temperature);
        setFieldErrors({});
        setError(null);
    };

    const loadState = useCallback(async (options?: { showLoading?: boolean }) => {
        const showLoading = options?.showLoading ?? true;
        try {
            if (showLoading) {
                setIsLoading(true);
            }
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
            const response = await fetch(`/api/teams/${teamId}/ai-key`, { headers });
            if (!response.ok) {
                setError(t('team.ai.error.load'));
                return;
            }

            const data = await response.json() as TeamAiState;
            setState(data);
            setProvider(data.providerConfig.provider ?? TEAM_AI_DEFAULTS.provider);
            setBaseUrl(data.providerConfig.baseUrl ?? TEAM_AI_DEFAULTS.baseUrl);
            setMainModel(data.providerConfig.mainModel ?? TEAM_AI_DEFAULTS.mainModel);
            setMainModelFamily(data.providerConfig.mainModelFamily ?? TEAM_AI_DEFAULTS.mainModelFamily);
            setPlanningModel(data.providerConfig.planningModel ?? TEAM_AI_DEFAULTS.planningModel);
            setPlanningModelFamily(data.providerConfig.planningModelFamily ?? TEAM_AI_DEFAULTS.planningModelFamily);
            setInsightModel(data.providerConfig.insightModel ?? TEAM_AI_DEFAULTS.insightModel);
            setInsightModelFamily(data.providerConfig.insightModelFamily ?? TEAM_AI_DEFAULTS.insightModelFamily);
            setTemperature(
                typeof data.providerConfig.temperature === 'number'
                    ? String(data.providerConfig.temperature)
                    : TEAM_AI_DEFAULTS.temperature
            );
            setError(null);
            setFieldErrors({});
        } finally {
            if (showLoading) {
                setIsLoading(false);
            }
        }
    }, [getAccessToken, teamId, t]);

    useEffect(() => {
        void loadState();
    }, [loadState]);

    const saveSettings = async () => {
        setError(null);
        setFieldErrors({});

        const nextFieldErrors: Partial<Record<ProviderFieldErrorKey, string>> = {};
        const temperatureTrimmed = temperature.trim();
        const parsedTemperature = temperatureTrimmed.length > 0
            ? Number.parseFloat(temperatureTrimmed)
            : null;

        if (
            temperatureTrimmed.length > 0
            && (
                parsedTemperature === null
                || !Number.isFinite(parsedTemperature)
                || parsedTemperature < 0
                || parsedTemperature > 2
            )
        ) {
            nextFieldErrors.temperature = t('team.ai.error.temperature');
        }

        if (Object.keys(nextFieldErrors).length > 0) {
            setFieldErrors(nextFieldErrors);
            return;
        }

        const payload: {
            apiKey?: string;
            providerConfig: {
                provider: TeamAiProvider;
                baseUrl: string;
                mainModel: string;
                mainModelFamily: string;
                planningModel: string;
                planningModelFamily: string;
                insightModel: string;
                insightModelFamily: string;
                temperature: number | null;
            };
        } = {
            providerConfig: {
                provider,
                baseUrl,
                mainModel,
                mainModelFamily,
                planningModel,
                planningModelFamily,
                insightModel,
                insightModelFamily,
                temperature: parsedTemperature,
            },
        };

        const trimmedApiKey = apiKey.trim();
        if (trimmedApiKey.length > 0) {
            payload.apiKey = trimmedApiKey;
        }

        setIsSaving(true);
        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${teamId}/ai-key`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json().catch(() => null) as {
                error?: string;
                details?: {
                    fieldErrors?: Record<string, string>;
                };
                maskedKey?: string | null;
            } | null;

            if (!response.ok) {
                setFieldErrors(toFieldErrorMap(data?.details?.fieldErrors));
                setError(data?.error || t('team.ai.error.save'));
                return;
            }

            if (trimmedApiKey.length > 0) {
                setApiKey('');
                setState((current) => ({
                    ...current,
                    hasKey: true,
                    maskedKey: data?.maskedKey ?? current.maskedKey,
                }));
            }

            await loadState({ showLoading: false });
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
                headers: token ? { Authorization: `Bearer ${token}` } : {},
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

    const providerOptions: Array<{ value: TeamAiProvider; label: string }> = [
        { value: 'openrouter', label: t('team.ai.provider.option.openrouter') },
        { value: 'openai-compatible', label: t('team.ai.provider.option.openaiCompatible') },
    ];

    const isFormDisabled = isLoading || isSaving;

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <div>
                <h2 className="text-base font-semibold text-gray-900">{t('team.ai.title')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('team.ai.description')}</p>
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
                        disabled={isSaving}
                        variant="secondary"
                        size="sm"
                        className="shrink-0 border-red-200 text-red-700 hover:bg-red-50"
                    >
                        {t('team.ai.remove')}
                    </Button>
                </div>
            ) : (
                <div className="space-y-1">
                    <div className="flex max-w-lg items-center gap-3">
                        <input
                            type="password"
                            value={apiKey}
                            disabled={isSaving}
                            onChange={(event) => {
                                setApiKey(event.target.value);
                                clearFieldError('apiKey');
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void saveSettings();
                                }
                            }}
                            placeholder={t('team.ai.placeholder')}
                            className="min-w-0 flex-1 rounded-md border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                        />
                    </div>
                    {fieldErrors.apiKey ? (
                        <p className="text-xs text-red-600">{fieldErrors.apiKey}</p>
                    ) : null}
                </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.provider.label')}</span>
                    <CustomSelect
                        value={provider}
                        options={providerOptions}
                        onChange={setProvider}
                        ariaLabel={t('team.ai.provider.label')}
                        disabled={isFormDisabled}
                        fullWidth
                        buttonClassName="shadow-none"
                    />
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.baseUrl')}</span>
                    <input
                        type="text"
                        value={baseUrl}
                        disabled={isFormDisabled}
                        onChange={(event) => {
                            setBaseUrl(event.target.value);
                            clearFieldError('baseUrl');
                        }}
                        placeholder="https://openrouter.ai/api/v1"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                    />
                    {fieldErrors.baseUrl ? (
                        <p className="text-xs text-red-600">{fieldErrors.baseUrl}</p>
                    ) : null}
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.mainModel')}</span>
                    <input
                        type="text"
                        value={mainModel}
                        disabled={isFormDisabled}
                        onChange={(event) => {
                            setMainModel(event.target.value);
                            clearFieldError('mainModel');
                        }}
                        placeholder="google/gemini-3.1-flash-lite-preview"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                    />
                    {fieldErrors.mainModel ? (
                        <p className="text-xs text-red-600">{fieldErrors.mainModel}</p>
                    ) : null}
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.mainModelFamily')}</span>
                    <CustomSelect
                        value={mainModelFamily}
                        options={MODEL_FAMILY_OPTIONS}
                        disabled={isFormDisabled}
                        onChange={(value) => {
                            setMainModelFamily(value);
                            clearFieldError('mainModelFamily');
                        }}
                        ariaLabel={t('team.ai.mainModelFamily')}
                        fullWidth
                        buttonClassName="shadow-none"
                    />
                    {fieldErrors.mainModelFamily ? (
                        <p className="text-xs text-red-600">{fieldErrors.mainModelFamily}</p>
                    ) : null}
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.planningModel')}</span>
                    <input
                        type="text"
                        value={planningModel}
                        disabled={isFormDisabled}
                        onChange={(event) => {
                            setPlanningModel(event.target.value);
                            clearFieldError('planningModel');
                        }}
                        placeholder="qwen/qwen3.5-27b"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                    />
                    {fieldErrors.planningModel ? (
                        <p className="text-xs text-red-600">{fieldErrors.planningModel}</p>
                    ) : null}
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.planningModelFamily')}</span>
                    <CustomSelect
                        value={planningModelFamily}
                        options={MODEL_FAMILY_OPTIONS}
                        disabled={isFormDisabled}
                        onChange={(value) => {
                            setPlanningModelFamily(value);
                            clearFieldError('planningModelFamily');
                        }}
                        ariaLabel={t('team.ai.planningModelFamily')}
                        fullWidth
                        buttonClassName="shadow-none"
                    />
                    {fieldErrors.planningModelFamily ? (
                        <p className="text-xs text-red-600">{fieldErrors.planningModelFamily}</p>
                    ) : null}
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.insightModel')}</span>
                    <input
                        type="text"
                        value={insightModel}
                        disabled={isFormDisabled}
                        onChange={(event) => {
                            setInsightModel(event.target.value);
                            clearFieldError('insightModel');
                        }}
                        placeholder="qwen/qwen3.5-27b"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                    />
                    {fieldErrors.insightModel ? (
                        <p className="text-xs text-red-600">{fieldErrors.insightModel}</p>
                    ) : null}
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.insightModelFamily')}</span>
                    <CustomSelect
                        value={insightModelFamily}
                        options={MODEL_FAMILY_OPTIONS}
                        disabled={isFormDisabled}
                        onChange={(value) => {
                            setInsightModelFamily(value);
                            clearFieldError('insightModelFamily');
                        }}
                        ariaLabel={t('team.ai.insightModelFamily')}
                        fullWidth
                        buttonClassName="shadow-none"
                    />
                    {fieldErrors.insightModelFamily ? (
                        <p className="text-xs text-red-600">{fieldErrors.insightModelFamily}</p>
                    ) : null}
                </label>
                <label className="space-y-1 md:col-span-2">
                    <span className="text-sm text-gray-700">{t('team.ai.temperature')}</span>
                    <input
                        type="number"
                        step="0.1"
                        value={temperature}
                        disabled={isFormDisabled}
                        onChange={(event) => {
                            setTemperature(event.target.value);
                            clearFieldError('temperature');
                        }}
                        placeholder="0.2"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                    />
                    {fieldErrors.temperature ? (
                        <p className="text-xs text-red-600">{fieldErrors.temperature}</p>
                    ) : null}
                </label>
            </div>

            <div className="flex items-center gap-2">
                <Button
                    variant="secondary"
                    size="sm"
                    disabled={isFormDisabled}
                    onClick={resetToDefaults}
                >
                    {t('team.ai.resetToDefault')}
                </Button>
                <Button
                    variant="primary"
                    size="sm"
                    disabled={isFormDisabled}
                    onClick={() => void saveSettings()}
                >
                    {isSaving ? t('team.ai.saving') : t('team.ai.save')}
                </Button>
            </div>

            <p className="text-xs text-gray-500">
                {t('team.ai.modelConfigHint')}{' '}
                <a
                    href="https://midscenejs.com/model-common-config"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                >
                    https://midscenejs.com/model-common-config
                </a>
            </p>

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
