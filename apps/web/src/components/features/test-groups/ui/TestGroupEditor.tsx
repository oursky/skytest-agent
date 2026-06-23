'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { Button, CustomSelect } from '@/components/shared';
import { TEST_GROUP_FAILURE_MODE, isRunActiveStatus, type TestGroupFailureMode, type TestGroupSummary } from '@/types';
import OrderedTestCasePicker from './OrderedTestCasePicker';

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

function defaultLoginSessionName(index: number): string {
    const letter = index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
    return `Login Session ${letter}`;
}

export default function TestGroupEditor({ projectId, group, onSaved, onCancel }: TestGroupEditorProps) {
    const { t } = useI18n();
    const { getAccessToken } = useAuth();
    const [name, setName] = useState(group?.name ?? '');
    const [displayId, setDisplayId] = useState(group?.displayId ?? '');
    const [onFailure, setOnFailure] = useState<TestGroupFailureMode>(group?.onFailure ?? TEST_GROUP_FAILURE_MODE.STOP);
    const [loginSessions, setLoginSessions] = useState<LoginSessionDraft[]>(
        group?.loginSessions.map((session) => ({ loginFlowId: session.loginFlowId, name: session.name })) ?? [],
    );
    const [testCaseIds, setTestCaseIds] = useState<string[]>(group?.items.map((item) => item.testCaseId) ?? []);
    const [loginFlowOptions, setLoginFlowOptions] = useState<LoginFlowOption[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const readOnly = isRunActiveStatus(group?.lastSessionStatus ?? null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetchWithAccessToken(
                    getAccessToken,
                    `/api/projects/${projectId}/test-cases?summary=1&kind=LOGIN_FLOW&limit=100`,
                );
                if (!response.ok) {
                    return;
                }
                const body = await response.json() as { data?: LoginFlowOption[] };
                if (!cancelled && Array.isArray(body.data)) {
                    setLoginFlowOptions(body.data);
                }
            } catch {
                // Leave empty on failure; the picker just shows nothing to add.
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

    const addLoginSession = (loginFlowId: string) => {
        if (!loginFlowId || loginSessions.some((session) => session.loginFlowId === loginFlowId)) {
            return;
        }
        setLoginSessions((prev) => [...prev, { loginFlowId, name: defaultLoginSessionName(prev.length) }]);
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

            <OrderedTestCasePicker projectId={projectId} value={testCaseIds} onChange={setTestCaseIds} readOnly={readOnly} />

            <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">{t('testGroup.onFailure')}</label>
                <div className="inline-flex rounded-md border border-gray-300 p-0.5">
                    {[TEST_GROUP_FAILURE_MODE.STOP, TEST_GROUP_FAILURE_MODE.CONTINUE].map((mode) => (
                        <button
                            key={mode}
                            type="button"
                            onClick={() => setOnFailure(mode)}
                            disabled={readOnly}
                            className={`rounded px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${onFailure === mode ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                            {mode === TEST_GROUP_FAILURE_MODE.STOP ? t('testGroup.onFailure.stop') : t('testGroup.onFailure.continue')}
                        </button>
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
