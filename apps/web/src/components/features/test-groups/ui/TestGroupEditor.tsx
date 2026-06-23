'use client';

import { useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import LoginFlowSelect from '@/components/features/test-configurations/ui/LoginFlowSelect';
import { Button } from '@/components/shared';
import type { TestGroupSummary } from '@/types';
import OrderedTestCasePicker from './OrderedTestCasePicker';

interface TestGroupEditorProps {
    projectId: string;
    group?: TestGroupSummary | null;
    onSaved: () => void;
    onCancel: () => void;
}

export default function TestGroupEditor({ projectId, group, onSaved, onCancel }: TestGroupEditorProps) {
    const { t } = useI18n();
    const { getAccessToken } = useAuth();
    const [name, setName] = useState(group?.name ?? '');
    const [displayId, setDisplayId] = useState(group?.displayId ?? '');
    const [loginFlowId, setLoginFlowId] = useState<string | undefined>(group?.loginFlowId ?? undefined);
    const [testCaseIds, setTestCaseIds] = useState<string[]>(group?.items.map((item) => item.testCaseId) ?? []);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

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
                    loginFlowId: loginFlowId ?? null,
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('testGroup.name')}</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('testGroup.name.placeholder')}
                        className="input-field"
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
                    />
                </div>
            </div>
            <LoginFlowSelect
                projectId={projectId}
                value={loginFlowId}
                size="md"
                labelSeparator=" • "
                onChange={setLoginFlowId}
            />
            <OrderedTestCasePicker projectId={projectId} value={testCaseIds} onChange={setTestCaseIds} />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" size="md" onClick={onCancel} disabled={isSaving}>{t('common.cancel')}</Button>
                <Button type="button" variant="primary" size="md" onClick={() => { void handleSave(); }} disabled={isSaving}>{t('common.save')}</Button>
            </div>
        </div>
    );
}
