'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { Button } from '@/components/shared';
import { getStatusBadgeClass } from '@/utils/status/statusBadge';
import type { RunGroupSummary } from '@/types';
import RunGroupEditor from './RunGroupEditor';

interface RunGroupsPanelProps {
    projectId: string;
    canManageProject: boolean;
}

type EditorState = { mode: 'create' } | { mode: 'edit'; group: RunGroupSummary } | null;

export default function RunGroupsPanel({ projectId, canManageProject }: RunGroupsPanelProps) {
    const { t } = useI18n();
    const { getAccessToken } = useAuth();
    const router = useRouter();
    const [groups, setGroups] = useState<RunGroupSummary[]>([]);
    const [editor, setEditor] = useState<EditorState>(null);
    const [runningId, setRunningId] = useState<string | null>(null);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        try {
            const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/run-groups`);
            if (response.ok) {
                setGroups(await response.json() as RunGroupSummary[]);
            }
        } catch {
            // Keep the last good list on a transient failure.
        }
    }, [projectId, getAccessToken]);

    useEffect(() => { void refresh(); }, [refresh]);

    const handleRun = async (group: RunGroupSummary) => {
        setRunningId(group.id);
        setError('');
        try {
            const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/run-groups/${group.id}/run`, { method: 'POST' });
            const body = await response.json().catch(() => null) as { sessionId?: string; error?: string } | null;
            if (!response.ok || !body?.sessionId) {
                setError(body?.error ?? t('runGroup.error.runFailed'));
                return;
            }
            router.push(`/run-groups/runs/${body.sessionId}?projectId=${projectId}`);
        } catch {
            setError(t('runGroup.error.runFailed'));
        } finally {
            setRunningId(null);
        }
    };

    const handleDelete = async (group: RunGroupSummary) => {
        await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/run-groups/${group.id}`, { method: 'DELETE' });
        await refresh();
    };

    if (editor) {
        return (
            <RunGroupEditor
                projectId={projectId}
                group={editor.mode === 'edit' ? editor.group : null}
                onSaved={() => { setEditor(null); void refresh(); }}
                onCancel={() => setEditor(null)}
            />
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">{t('runGroup.title')}</h2>
                {canManageProject && (
                    <Button type="button" size="sm" onClick={() => setEditor({ mode: 'create' })}>{t('runGroup.new')}</Button>
                )}
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            {groups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">{t('runGroup.empty')}</p>
            ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                    {groups.map((group) => (
                        <div key={group.id} className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    {group.displayId && <span className="font-mono text-xs text-gray-500">{group.displayId}</span>}
                                    <span className="truncate text-sm font-medium text-gray-900">{group.name}</span>
                                </div>
                                <div className="text-xs text-gray-500">{t('runGroup.caseCount', { count: group.items.length })}</div>
                            </div>
                            {group.lastSessionStatus && (
                                <Link href={`/run-groups/runs/${group.lastSessionId}?projectId=${projectId}`} className={`rounded border px-2 py-0.5 text-xs ${getStatusBadgeClass(group.lastSessionStatus)}`}>
                                    {group.lastSessionStatus}
                                </Link>
                            )}
                            <Button type="button" size="sm" onClick={() => { void handleRun(group); }} disabled={runningId === group.id || group.items.length === 0}>
                                {runningId === group.id ? t('runGroup.running') : t('runGroup.run')}
                            </Button>
                            {canManageProject && (
                                <>
                                    <button type="button" onClick={() => setEditor({ mode: 'edit', group })} className="text-xs text-gray-500 hover:text-primary">{t('common.edit')}</button>
                                    <button type="button" onClick={() => { void handleDelete(group); }} className="text-xs text-gray-400 hover:text-red-500">{t('common.delete')}</button>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
