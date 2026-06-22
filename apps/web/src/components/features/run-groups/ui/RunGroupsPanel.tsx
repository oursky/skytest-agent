'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { Button, LoadingSpinner, Modal } from '@/components/shared';
import { getStatusBadgeClass } from '@/utils/status/statusBadge';
import { isRunActiveStatus, type RunGroupSummary } from '@/types';
import RunGroupEditor from './RunGroupEditor';

interface RunGroupsPanelProps {
    projectId: string;
    canManageProject: boolean;
}

type EditorState = { mode: 'create' } | { mode: 'edit'; group: RunGroupSummary } | null;

const PlayIcon = () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const StopIcon = () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <rect x={6} y={6} width={12} height={12} rx={2} strokeWidth={2} />
    </svg>
);

const EditIcon = () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
);

const TrashIcon = () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
);

export default function RunGroupsPanel({ projectId, canManageProject }: RunGroupsPanelProps) {
    const { t } = useI18n();
    const { getAccessToken } = useAuth();
    const router = useRouter();
    const [groups, setGroups] = useState<RunGroupSummary[]>([]);
    const [editor, setEditor] = useState<EditorState>(null);
    const [runningId, setRunningId] = useState<string | null>(null);
    const [stoppingId, setStoppingId] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<RunGroupSummary | null>(null);
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

    const handleStop = async (group: RunGroupSummary) => {
        if (!group.lastSessionId) return;
        setStoppingId(group.id);
        setError('');
        try {
            await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/run-sessions/${group.lastSessionId}`, { method: 'POST' });
            await refresh();
        } catch {
            setError(t('runGroup.error.stopFailed'));
        } finally {
            setStoppingId(null);
        }
    };

    const handleDelete = async (group: RunGroupSummary) => {
        await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/run-groups/${group.id}`, { method: 'DELETE' });
        setPendingDelete(null);
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
                    {groups.map((group) => {
                        const isActive = isRunActiveStatus(group.lastSessionStatus);
                        const isStarting = runningId === group.id;
                        const isStopping = stoppingId === group.id;
                        return (
                            <div key={group.id} className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        {group.displayId && <span className="font-mono text-xs text-gray-500">{group.displayId}</span>}
                                        <span className="truncate text-sm font-medium text-gray-900">{group.name}</span>
                                    </div>
                                    <div className="text-xs text-gray-500">{t('runGroup.caseCount', { count: group.items.length })}</div>
                                </div>
                                {group.lastSessionStatus && group.lastSessionId && (
                                    <Link
                                        href={`/run-groups/runs/${group.lastSessionId}?projectId=${projectId}`}
                                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(group.lastSessionStatus)}`}
                                        title={t('runGroup.tooltip.viewLast')}
                                    >
                                        {group.lastSessionStatus}
                                    </Link>
                                )}
                                <div className="flex items-center justify-end gap-1">
                                    {isActive ? (
                                        <button
                                            type="button"
                                            onClick={() => { void handleStop(group); }}
                                            disabled={isStopping || !canManageProject}
                                            className="inline-flex items-center justify-center rounded-md p-2 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                                            title={t('runGroup.tooltip.stop')}
                                            aria-label={t('runGroup.tooltip.stop')}
                                        >
                                            {isStopping ? <LoadingSpinner size={18} /> : <StopIcon />}
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => { void handleRun(group); }}
                                            disabled={isStarting || group.items.length === 0 || !canManageProject}
                                            className="inline-flex items-center justify-center rounded-md p-2 text-gray-500 transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                            title={t('runGroup.tooltip.run')}
                                            aria-label={t('runGroup.tooltip.run')}
                                        >
                                            {isStarting ? <LoadingSpinner size={18} /> : <PlayIcon />}
                                        </button>
                                    )}
                                    {canManageProject && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => setEditor({ mode: 'edit', group })}
                                                className="inline-flex items-center justify-center rounded-md p-2 text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
                                                title={t('common.edit')}
                                                aria-label={t('common.edit')}
                                            >
                                                <EditIcon />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setPendingDelete(group)}
                                                disabled={isActive}
                                                className="inline-flex items-center justify-center rounded-md p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                                                title={isActive ? t('runGroup.tooltip.cannotDeleteRunning') : t('common.delete')}
                                                aria-label={t('common.delete')}
                                            >
                                                <TrashIcon />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            <Modal
                isOpen={pendingDelete !== null}
                onClose={() => setPendingDelete(null)}
                title={t('runGroup.delete.confirmTitle')}
                confirmText={t('common.delete')}
                cancelText={t('common.cancel')}
                confirmVariant="danger"
                onConfirm={() => { if (pendingDelete) void handleDelete(pendingDelete); }}
                closeOnConfirm={false}
            >
                <p className="text-sm text-gray-600">{t('runGroup.delete.confirmBody', { name: pendingDelete?.name ?? '' })}</p>
            </Modal>
        </div>
    );
}
