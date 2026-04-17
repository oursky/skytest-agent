'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { Button, CustomSelect, LoadingSpinner, Modal } from '@/components/shared';
import { useI18n } from '@/i18n';
import { MIDSCENE_MODEL_DEFAULTS } from '@/lib/runtime/model-families';
import { validateAiApiKey, type AiApiKeyInvalidReason } from '@/lib/validation/ai-api-key';

interface TeamAiSettingsProps {
    teamId: string;
}

type TeamAiProvider = 'openrouter' | 'openai-compatible';

type ProviderFieldErrorKey =
    | 'apiKey'
    | 'baseUrl'
    | 'mainModel'
    | 'planningModel'
    | 'insightModel'
    | 'temperature';

interface TeamAiState {
    hasKey: boolean;
    maskedKey: string | null;
    updatedAt: string | null;
    keyInvalid: boolean;
    keyInvalidReason: AiApiKeyInvalidReason | null;
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

interface ProviderFormState {
    provider: TeamAiProvider;
    baseUrl: string;
    mainModel: string;
    planningModel: string;
    insightModel: string;
    temperature: string;
}

const DEFAULT_PROVIDER: TeamAiProvider = 'openrouter';

const API_KEY_REASON_MESSAGE_KEYS: Record<AiApiKeyInvalidReason, string> = {
    empty: 'team.ai.apiKey.invalid.empty',
    too_short: 'team.ai.apiKey.invalid.tooShort',
    non_ascii: 'team.ai.apiKey.invalid.nonAscii',
};

export interface TeamAiApiKeyInputValidation {
    trimmedApiKey: string;
    reason: AiApiKeyInvalidReason | null;
    shouldSubmit: boolean;
}

export function getTeamAiApiKeyReasonMessageKey(reason: AiApiKeyInvalidReason): string {
    return API_KEY_REASON_MESSAGE_KEYS[reason];
}

export function validateProvidedTeamAiApiKeyInput(apiKeyInput: string): TeamAiApiKeyInputValidation {
    const trimmedApiKey = apiKeyInput.trim();
    if (apiKeyInput.length === 0) {
        return {
            trimmedApiKey,
            reason: null,
            shouldSubmit: true,
        };
    }

    const validation = validateAiApiKey(trimmedApiKey);
    if (!validation.ok) {
        return {
            trimmedApiKey,
            reason: validation.reason,
            shouldSubmit: false,
        };
    }

    return {
        trimmedApiKey,
        reason: null,
        shouldSubmit: true,
    };
}

function buildProviderFormState(providerConfig?: TeamAiState['providerConfig']): ProviderFormState {
    return {
        provider: providerConfig?.provider ?? DEFAULT_PROVIDER,
        baseUrl: providerConfig?.baseUrl ?? MIDSCENE_MODEL_DEFAULTS.baseUrl,
        mainModel: providerConfig?.mainModel ?? MIDSCENE_MODEL_DEFAULTS.mainModel,
        planningModel: providerConfig?.planningModel ?? MIDSCENE_MODEL_DEFAULTS.planningModel,
        insightModel: providerConfig?.insightModel ?? MIDSCENE_MODEL_DEFAULTS.insightModel,
        temperature: typeof providerConfig?.temperature === 'number'
            ? String(providerConfig.temperature)
            : String(MIDSCENE_MODEL_DEFAULTS.temperature),
    };
}

function toFieldErrorMap(input: unknown): Partial<Record<ProviderFieldErrorKey, string>> {
    if (!input || typeof input !== 'object') {
        return {};
    }

    const result: Partial<Record<ProviderFieldErrorKey, string>> = {};
    const validKeys: ProviderFieldErrorKey[] = [
        'apiKey',
        'baseUrl',
        'mainModel',
        'planningModel',
        'insightModel',
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
        keyInvalid: false,
        keyInvalidReason: null,
        providerConfig: {
            provider: DEFAULT_PROVIDER,
            baseUrl: null,
            mainModel: null,
            mainModelFamily: null,
            planningModel: null,
            planningModelFamily: null,
            insightModel: null,
            insightModelFamily: null,
            temperature: null,
        },
    });
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProviderFieldErrorKey, string>>>({});

    const [apiKey, setApiKey] = useState('');
    const [providerForm, setProviderForm] = useState<ProviderFormState>(() => buildProviderFormState());

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
        setProviderForm(buildProviderFormState());
        setFieldErrors({});
        setError(null);
        setNotice(null);
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
            setProviderForm(buildProviderFormState(data.providerConfig));
            setError(null);
            setNotice(null);
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
        setNotice(null);
        setFieldErrors({});

        const nextFieldErrors: Partial<Record<ProviderFieldErrorKey, string>> = {};
        const apiKeyValidation = validateProvidedTeamAiApiKeyInput(apiKey);
        const trimmedApiKey = apiKeyValidation.trimmedApiKey;
        if (!apiKeyValidation.shouldSubmit && apiKeyValidation.reason) {
            nextFieldErrors.apiKey = t(getTeamAiApiKeyReasonMessageKey(apiKeyValidation.reason));
        }

        const temperatureTrimmed = providerForm.temperature.trim();
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
                planningModel: string;
                insightModel: string;
                temperature: number | null;
            };
        } = {
            providerConfig: {
                provider: providerForm.provider,
                baseUrl: providerForm.baseUrl,
                mainModel: providerForm.mainModel,
                planningModel: providerForm.planningModel,
                insightModel: providerForm.insightModel,
                temperature: parsedTemperature,
            },
        };

        const hadStoredKey = state.hasKey;
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
            if (trimmedApiKey.length === 0 && !hadStoredKey) {
                setNotice(t('team.ai.notice.keyMissingAfterConfigSave'));
            }
        } catch {
            setError(t('team.ai.error.save'));
        } finally {
            setIsSaving(false);
        }
    };

    const removeKey = async () => {
        setIsRemoveConfirmOpen(false);
        setError(null);
        setNotice(null);

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

            {notice ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {notice}
                </div>
            ) : null}

            {state.keyInvalid ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {t('team.ai.apiKey.storedInvalid')}
                </div>
            ) : null}

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
                    <p className="text-xs text-gray-500">{t('team.ai.apiKey.helperText')}</p>
                    {fieldErrors.apiKey ? (
                        <p className="text-xs text-red-600">{fieldErrors.apiKey}</p>
                    ) : null}
                </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.provider.label')}</span>
                    <CustomSelect
                        value={providerForm.provider}
                        options={providerOptions}
                        onChange={(value) => setProviderForm((current) => ({ ...current, provider: value }))}
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
                        value={providerForm.baseUrl}
                        disabled={isFormDisabled}
                        onChange={(event) => {
                            setProviderForm((current) => ({ ...current, baseUrl: event.target.value }));
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
                        value={providerForm.mainModel}
                        disabled={isFormDisabled}
                        onChange={(event) => {
                            setProviderForm((current) => ({ ...current, mainModel: event.target.value }));
                            clearFieldError('mainModel');
                        }}
                        placeholder="qwen/qwen3.6-plus"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                    />
                    {fieldErrors.mainModel ? (
                        <p className="text-xs text-red-600">{fieldErrors.mainModel}</p>
                    ) : null}
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.planningModel')}</span>
                    <input
                        type="text"
                        value={providerForm.planningModel}
                        disabled={isFormDisabled}
                        onChange={(event) => {
                            setProviderForm((current) => ({ ...current, planningModel: event.target.value }));
                            clearFieldError('planningModel');
                        }}
                        placeholder="qwen/qwen3.6-plus"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                    />
                    {fieldErrors.planningModel ? (
                        <p className="text-xs text-red-600">{fieldErrors.planningModel}</p>
                    ) : null}
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.insightModel')}</span>
                    <input
                        type="text"
                        value={providerForm.insightModel}
                        disabled={isFormDisabled}
                        onChange={(event) => {
                            setProviderForm((current) => ({ ...current, insightModel: event.target.value }));
                            clearFieldError('insightModel');
                        }}
                        placeholder="qwen/qwen3.6-plus"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                    />
                    {fieldErrors.insightModel ? (
                        <p className="text-xs text-red-600">{fieldErrors.insightModel}</p>
                    ) : null}
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-gray-700">{t('team.ai.temperature')}</span>
                    <input
                        type="number"
                        step="0.1"
                        value={providerForm.temperature}
                        disabled={isFormDisabled}
                        onChange={(event) => {
                            setProviderForm((current) => ({ ...current, temperature: event.target.value }));
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
