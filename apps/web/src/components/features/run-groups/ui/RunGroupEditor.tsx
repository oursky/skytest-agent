'use client';

import { useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import LoginFlowSelect from '@/components/features/test-configurations/ui/LoginFlowSelect';
import { Button } from '@/components/shared';
import type { RunGroupSummary } from '@/types';
import OrderedTestCasePicker from './OrderedTestCasePicker';

interface RunGroupEditorProps {
    projectId: string;
    group?: RunGroupSummary | null;
    onSaved: () => void;
    onCancel: () => void;
}

export default function RunGroupEditor({ projectId, group, onSaved, onCancel }: RunGroupEditorProps) {
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
            setError(t('runGroup.error.nameRequired'));
            return;
        }
        setIsSaving(true);
        setError('');
        try {
            const url = group
                ? `/api/projects/${projectId}/run-groups/${group.id}`
                : `/api/projects/${projectId}/run-groups`;
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
                setError(body?.error ?? t('runGroup.error.saveFailed'));
                return;
            }
            onSaved();
        } catch {
            setError(t('runGroup.error.saveFailed'));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900">{group ? t('runGroup.edit') : t('runGroup.new')}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <label className="text-[10px] font-medium text-gray-500 uppercase">{t('runGroup.name')}</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('runGroup.name.placeholder')}
                        className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>
                <div>
                    <label className="text-[10px] font-medium text-gray-500 uppercase">{t('runGroup.displayId')}</label>
                    <input
                        type="text"
                        value={displayId}
                        onChange={(e) => setDisplayId(e.target.value)}
                        placeholder="GROUP-001"
                        className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>
            </div>
            <LoginFlowSelect
                projectId={projectId}
                value={loginFlowId}
                onChange={setLoginFlowId}
            />
            <OrderedTestCasePicker projectId={projectId} value={testCaseIds} onChange={setTestCaseIds} />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={isSaving}>{t('common.cancel')}</Button>
                <Button type="button" size="sm" onClick={() => { void handleSave(); }} disabled={isSaving}>{t('common.save')}</Button>
            </div>
        </div>
    );
}
