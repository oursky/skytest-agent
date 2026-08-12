'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { Button, CustomSelect } from '@/components/shared';
import { extractListData } from '@/utils/pagination/pagination';
import { TEST_GROUP_FAILURE_MODE, TEST_GROUP_EXECUTION_MODE, TEST_GROUP_RETRY_POLICY, TEST_GROUP_RETRY_POLICIES, isRunActiveStatus, type TestGroupFailureMode, type TestGroupExecutionMode, type TestGroupRetryPolicy, type TestGroupSummary } from '@/types';
import type { TranslationVars } from '@/i18n/types';
import OrderedTestCasePicker, { type TestCaseOption } from './OrderedTestCasePicker';

interface TestGroupEditorProps {
    projectId: string;
    group?: TestGroupSummary | null;
    onSaved: () => void;
    onCancel: () => void;
}

interface LoginFlowOption {
    id: string;
    displayId?: string | null;
    name: string;
}

interface LoginSessionDraft {
    loginFlowId: string;
    name: string;
}

function defaultLoginSessionName(index: number, t: (key: string, vars?: TranslationVars) => string): string {
    const label = index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
    return t('testGroup.loginSessions.defaultName', { label });
}

export function buildRetryPolicyOptions(t: (key: string) => string): Record<TestGroupRetryPolicy, { label: string; description: string }> {
    return {
        [TEST_GROUP_RETRY_POLICY.NONE]: {
            label: t('testGroup.retryPolicy.none'),
            description: t('testGroup.retryPolicy.none.description'),
        },
        [TEST_GROUP_RETRY_POLICY.FAILED_ONCE]: {
            label: t('testGroup.retryPolicy.failedOnce'),
            description: t('testGroup.retryPolicy.failedOnce.description'),
        },
        [TEST_GROUP_RETRY_POLICY.FAILED_TWICE]: {
            label: t('testGroup.retryPolicy.failedTwice'),
            description: t('testGroup.retryPolicy.failedTwice.description'),
        },
        [TEST_GROUP_RETRY_POLICY.WHOLE_GROUP_ONCE]: {
            label: t('testGroup.retryPolicy.wholeGroupOnce'),
            description: t('testGroup.retryPolicy.wholeGroupOnce.description'),
        },
    };
}

export default function TestGroupEditor({ projectId, group, onSaved, onCancel }: TestGroupEditorProps) {
    const { t } = useI18n();
    const { getAccessToken } = useAuth();
    const [name, setName] = useState(group?.name ?? '');
    const [displayId, setDisplayId] = useState(group?.displayId ?? '');
    const [onFailure, setOnFailure] = useState<TestGroupFailureMode>(group?.onFailure ?? TEST_GROUP_FAILURE_MODE.STOP);
    const [executionMode, setExecutionMode] = useState<TestGroupExecutionMode>(group?.executionMode ?? TEST_GROUP_EXECUTION_MODE.SEQUENTIAL);
    const [retryPolicy, setRetryPolicy] = useState<TestGroupRetryPolicy>(group?.retryPolicy ?? TEST_GROUP_RETRY_POLICY.NONE);
    const [loginSessions, setLoginSessions] = useState<LoginSessionDraft[]>(
        group?.loginSessions.map((session) => ({ loginFlowId: session.loginFlowId, name: session.name })) ?? [],
    );
    const [testCaseIds, setTestCaseIds] = useState<string[]>(group?.items.map((item) => item.testCaseId) ?? []);
    const [loginFlowOptions, setLoginFlowOptions] = useState<LoginFlowOption[]>([]);
    const [testCaseOptions, setTestCaseOptions] = useState<TestCaseOption[]>([]);
    const [optionsLoaded, setOptionsLoaded] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const readOnly = isRunActiveStatus(group?.lastSessionStatus ?? null);
    // Existing groups reference test cases and login flows by id; the friendly labels come from
    // these lists, so hold the form behind a skeleton until they arrive to avoid a raw-id flash.
    // Create mode has nothing to resolve, so it renders immediately.
    const isInitializing = Boolean(group) && !optionsLoaded;

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const [loginResponse, testResponse] = await Promise.all([
                    fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/test-cases?summary=1&kind=LOGIN_FLOW&limit=100`),
                    fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/test-cases?summary=1&kind=TEST&limit=100`),
                ]);
                if (loginResponse.ok) {
                    const options = extractListData<LoginFlowOption>(await loginResponse.json());
                    if (!cancelled) {
                        setLoginFlowOptions(options);
                    }
                }
                if (testResponse.ok) {
                    const options = extractListData<TestCaseOption>(await testResponse.json());
                    if (!cancelled) {
                        setTestCaseOptions(options);
                    }
                }
            } catch {
                // Leave empty on failure; the pickers just show nothing to add.
            } finally {
                if (!cancelled) {
                    setOptionsLoaded(true);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [projectId, getAccessToken]);

    const optionById = useMemo(() => new Map(loginFlowOptions.map((option) => [option.id, option])), [loginFlowOptions]);
    const flowLabel = (id: string) => {
        const option = optionById.get(id);
        if (!option) return id;
        return option.displayId ? `${option.displayId} • ${option.name}` : option.name;
    };
    const availableFlows = loginFlowOptions.filter((option) => !loginSessions.some((session) => session.loginFlowId === option.id));
    const retryPolicyOptions = buildRetryPolicyOptions(t);

    const addLoginSession = (loginFlowId: string) => {
        if (!loginFlowId || loginSessions.some((session) => session.loginFlowId === loginFlowId)) {
            return;
        }
        setLoginSessions((prev) => [...prev, { loginFlowId, name: defaultLoginSessionName(prev.length, t) }]);
    };
    const renameLoginSession = (index: number, value: string) => {
        setLoginSessions((prev) => prev.map((session, i) => (i === index ? { ...session, name: value } : session)));
    };
    const removeLoginSession = (index: number) => {
        setLoginSessions((prev) => prev.filter((_, i) => i !== index));
    };

    const handleSave = async () => {
        if (!name.trim()) {
            setError(t('testGroup.error.nameRequired'));
            return;
        }
        setIsSaving(true);
        setError('');
        try {
            const url = group
                ? `/api/projects/${projectId}/test-groups/${group.id}`
                : `/api/projects/${projectId}/test-groups`;
            const response = await fetchWithAccessToken(getAccessToken, url, {
                method: group ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    displayId: displayId.trim() || null,
                    onFailure,
                    executionMode,
                    retryPolicy,
                    loginSessions: loginSessions.map((session) => ({ loginFlowId: session.loginFlowId, name: session.name.trim() || undefined })),
                    testCaseIds,
                }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => null) as { error?: string } | null;
                setError(body?.error ?? t('testGroup.error.saveFailed'));
                return;
            }
            onSaved();
        } catch {
            setError(t('testGroup.error.saveFailed'));
        } finally {
            setIsSaving(false);
        }
    };

    if (isInitializing) {
        return (
            <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <div className="skeleton-block h-6 w-40" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <div className="skeleton-block h-4 w-20" />
                        <div className="skeleton-block h-9 w-full" />
                    </div>
                    <div className="space-y-2">
                        <div className="skeleton-block h-4 w-20" />
                        <div className="skeleton-block h-9 w-full" />
                    </div>
                </div>
                <div className="space-y-2">
                    <div className="skeleton-block h-4 w-28" />
                    <div className="skeleton-block h-9 w-full" />
                </div>
                <div className="space-y-2">
                    <div className="skeleton-block h-4 w-32" />
                    {Array.from({ length: 4 }, (_, index) => (
                        <div key={`test-group-editor-skeleton-${index}`} className="skeleton-block h-10 w-full" />
                    ))}
                </div>
                <div className="flex justify-end gap-2">
                    <div className="skeleton-block h-9 w-20" />
                    <div className="skeleton-block h-9 w-20" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">{group ? t('testGroup.edit') : t('testGroup.new')}</h2>
            {readOnly && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('testGroup.running.locked')}</p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('testGroup.name')}</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('testGroup.name.placeholder')}
                        className="input-field"
                        disabled={readOnly}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('testGroup.displayId')}</label>
                    <input
                        type="text"
                        value={displayId}
                        onChange={(e) => setDisplayId(e.target.value)}
                        placeholder="GROUP-001"
                        className="input-field"
                        disabled={readOnly}
                    />
                </div>
            </div>

            <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">{t('testGroup.loginSessions')}</label>
                {loginSessions.length > 0 && (
                    <ul className="space-y-1.5">
                        {loginSessions.map((session, index) => (
                            <li key={session.loginFlowId} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                                <input
                                    type="text"
                                    value={session.name}
                                    onChange={(e) => renameLoginSession(index, e.target.value)}
                                    placeholder={t('testGroup.loginSessions.namePlaceholder')}
                                    className="w-44 shrink-0 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                                    disabled={readOnly}
                                />
                                <span className="flex-1 truncate text-gray-500">{flowLabel(session.loginFlowId)}</span>
                                <button
                                    type="button"
                                    onClick={() => removeLoginSession(index)}
                                    disabled={readOnly}
                                    className="rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-30"
                                    aria-label={t('common.remove')}
                                >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {optionsLoaded && loginFlowOptions.length === 0 && loginSessions.length === 0 && (
                    <p className="text-sm text-gray-500">{t('testGroup.loginSessions.empty')}</p>
                )}
                {!readOnly && availableFlows.length > 0 && (
                    <CustomSelect
                        value=""
                        options={[
                            { value: '', label: t('testGroup.loginSessions.add') },
                            ...availableFlows.map((option) => ({
                                value: option.id,
                                label: option.displayId ? `${option.displayId} • ${option.name}` : option.name,
                            })),
                        ]}
                        onChange={(next) => { if (next) addLoginSession(next); }}
                        fullWidth
                        ariaLabel={t('testGroup.loginSessions.add')}
                    />
                )}
            </div>

            <OrderedTestCasePicker
                options={testCaseOptions}
                value={testCaseIds}
                onChange={setTestCaseIds}
                readOnly={readOnly}
                loginSessions={loginSessions}
                resolveLoginFlowName={flowLabel}
            />

            <div className="space-y-2">
                <span className="block text-sm font-medium text-gray-700">{t('testGroup.executionMode')}</span>
                <div className="space-y-2">
                    {[TEST_GROUP_EXECUTION_MODE.SEQUENTIAL, TEST_GROUP_EXECUTION_MODE.PARALLEL].map((execMode) => (
                        <label key={execMode} className={`flex items-center gap-2 text-sm ${readOnly ? 'text-gray-400' : 'cursor-pointer text-gray-700'}`}>
                            <input
                                type="radio"
                                name="testGroupExecutionMode"
                                value={execMode}
                                checked={executionMode === execMode}
                                onChange={() => setExecutionMode(execMode)}
                                disabled={readOnly}
                                className="h-4 w-4 text-primary focus:ring-primary disabled:opacity-50"
                            />
                            {execMode === TEST_GROUP_EXECUTION_MODE.SEQUENTIAL ? t('testGroup.executionMode.sequential') : t('testGroup.executionMode.parallel')}
                        </label>
                    ))}
                </div>
                <p className="text-xs text-gray-500">{t('testGroup.executionMode.hint')}</p>
            </div>

            <div className="space-y-2">
                <span className="block text-sm font-medium text-gray-700">{t('testGroup.onFailure')}</span>
                <div className="space-y-2">
                    {[TEST_GROUP_FAILURE_MODE.STOP, TEST_GROUP_FAILURE_MODE.CONTINUE].map((mode) => (
                        <label key={mode} className={`flex items-center gap-2 text-sm ${readOnly ? 'text-gray-400' : 'cursor-pointer text-gray-700'}`}>
                            <input
                                type="radio"
                                name="testGroupOnFailure"
                                value={mode}
                                checked={onFailure === mode}
                                onChange={() => setOnFailure(mode)}
                                disabled={readOnly}
                                className="h-4 w-4 text-primary focus:ring-primary disabled:opacity-50"
                            />
                            {mode === TEST_GROUP_FAILURE_MODE.STOP ? t('testGroup.onFailure.stop') : t('testGroup.onFailure.continue')}
                        </label>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <span className="block text-sm font-medium text-gray-700">{t('testGroup.retryPolicy')}</span>
                <div className="space-y-2">
                    {TEST_GROUP_RETRY_POLICIES.map((policy) => (
                        <label key={policy} className={`flex items-start gap-2 text-sm ${readOnly ? 'text-gray-400' : 'cursor-pointer text-gray-700'}`}>
                            <input
                                type="radio"
                                name="testGroupRetryPolicy"
                                value={policy}
                                checked={retryPolicy === policy}
                                onChange={() => setRetryPolicy(policy)}
                                disabled={readOnly}
                                className="mt-0.5 h-4 w-4 shrink-0 text-primary focus:ring-primary disabled:opacity-50"
                            />
                            <span>
                                <span className="block">{retryPolicyOptions[policy].label}</span>
                                <span className={`mt-0.5 block text-xs ${readOnly ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {retryPolicyOptions[policy].description}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" size="md" onClick={onCancel} disabled={isSaving}>{t('common.cancel')}</Button>
                <Button type="button" variant="primary" size="md" onClick={() => { void handleSave(); }} disabled={isSaving || readOnly}>{t('common.save')}</Button>
            </div>
        </div>
    );
}
