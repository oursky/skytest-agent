'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { LoadingSpinner, Modal } from '@/components/shared';
import { getStatusBadgeClass } from '@/utils/status/statusBadge';
import { formatDateTimeCompact } from '@/utils/time/dateFormatter';
import { isRunActiveStatus, type RunGroupSummary } from '@/types';
import RunGroupEditor from './RunGroupEditor';

interface RunGroupsPanelProps {
    projectId: string;
    canManageProject: boolean;
}

type EditorState = { mode: 'create' } | { mode: 'edit'; group: RunGroupSummary } | null;
type SortColumn = 'id' | 'name' | 'status' | 'updated';

function SortIcon({ column, sortColumn, sortDirection }: { column: SortColumn; sortColumn: SortColumn; sortDirection: 'asc' | 'desc' }) {
    if (sortColumn !== column) {
        return (
            <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
        );
    }
    return (
        <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
        </svg>
    );
}

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
    const [search, setSearch] = useState('');
    const [sortColumn, setSortColumn] = useState<SortColumn>('id');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [error, setError] = useState('');

    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

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

    const visibleGroups = useMemo(() => {
        const query = search.trim().toLowerCase();
        const filtered = !query
            ? groups
            : groups.filter((group) =>
                group.name.toLowerCase().includes(query)
                || (group.displayId ?? '').toLowerCase().includes(query));
        const sortValue = (group: RunGroupSummary): string => {
            switch (sortColumn) {
                case 'name': return group.name.toLowerCase();
                case 'status': return (group.lastSessionStatus ?? 'DRAFT').toLowerCase();
                case 'updated': return group.lastSessionAt ?? group.updatedAt;
                default: return (group.displayId ?? '').toLowerCase();
            }
        };
        return [...filtered].sort((a, b) => {
            const av = sortValue(a);
            const bv = sortValue(b);
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return sortDirection === 'asc' ? cmp : -cmp;
        });
    }, [groups, search, sortColumn, sortDirection]);

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
        <div>
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-4">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0 4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0-5.571 3-5.571-3" />
                </svg>
                <p className="text-sm text-indigo-900/80">{t('runGroup.caption')}</p>
            </div>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative sm:w-64">
                    <input
                        type="text"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t('project.search.placeholder')}
                        className="w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-10 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </span>
                </div>
                {canManageProject && (
                    <button
                        type="button"
                        onClick={() => setEditor({ mode: 'create' })}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary/90"
                    >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        {t('runGroup.new')}
                    </button>
                )}
            </div>

            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="hidden grid-cols-24 gap-4 border-b border-gray-200 bg-gray-50 p-4 text-sm font-medium text-gray-500 md:grid">
                    <button type="button" onClick={() => handleSort('id')} className="col-span-4 flex items-center gap-1 text-left transition-colors hover:text-gray-700">
                        {t('project.table.id')}
                        <SortIcon column="id" sortColumn={sortColumn} sortDirection={sortDirection} />
                    </button>
                    <button type="button" onClick={() => handleSort('name')} className="col-span-8 flex items-center gap-1 text-left transition-colors hover:text-gray-700">
                        {t('project.table.name')}
                        <SortIcon column="name" sortColumn={sortColumn} sortDirection={sortDirection} />
                    </button>
                    <button type="button" onClick={() => handleSort('status')} className="col-span-4 flex items-center gap-1 text-left transition-colors hover:text-gray-700">
                        {t('project.table.status')}
                        <SortIcon column="status" sortColumn={sortColumn} sortDirection={sortDirection} />
                    </button>
                    <button type="button" onClick={() => handleSort('updated')} className="col-span-4 flex items-center gap-1 text-left transition-colors hover:text-gray-700">
                        {t('project.table.updated')}
                        <SortIcon column="updated" sortColumn={sortColumn} sortDirection={sortDirection} />
                    </button>
                    <div className="col-span-4 text-right">{t('project.table.actions')}</div>
                </div>

                {visibleGroups.length === 0 ? (
                    <p className="p-16 text-center text-sm text-gray-500">
                        {groups.length === 0 ? t('runGroup.empty') : t('runGroup.noResults')}
                    </p>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {visibleGroups.map((group) => {
                            const isActive = isRunActiveStatus(group.lastSessionStatus);
                            const isStarting = runningId === group.id;
                            const isStopping = stoppingId === group.id;
                            return (
                                <div key={group.id} className="flex flex-col gap-4 p-4 transition-colors hover:bg-gray-50 md:grid md:grid-cols-24 md:items-center">
                                    <div className="md:col-span-4 flex items-center">
                                        {group.displayId ? (
                                            canManageProject ? (
                                                <button type="button" onClick={() => setEditor({ mode: 'edit', group })} className="font-mono text-xs text-gray-500 transition-colors hover:text-primary">{group.displayId}</button>
                                            ) : (
                                                <span className="font-mono text-xs text-gray-500">{group.displayId}</span>
                                            )
                                        ) : (
                                            <span className="text-sm text-gray-400">-</span>
                                        )}
                                    </div>
                                    <div className="md:col-span-8 flex flex-col justify-center gap-0.5">
                                        {canManageProject ? (
                                            <button type="button" onClick={() => setEditor({ mode: 'edit', group })} className="text-left font-medium text-gray-900 transition-colors hover:text-primary">{group.name}</button>
                                        ) : (
                                            <span className="font-medium text-gray-900">{group.name}</span>
                                        )}
                                        <span className="text-xs text-gray-400">{t('runGroup.caseCount', { count: group.items.length })}</span>
                                    </div>
                                    <div className="md:col-span-4 flex items-center">
                                        {group.lastSessionStatus && group.lastSessionId ? (
                                            <Link
                                                href={`/run-groups/runs/${group.lastSessionId}?projectId=${projectId}`}
                                                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(group.lastSessionStatus)}`}
                                                title={t('runGroup.tooltip.viewLast')}
                                            >
                                                {group.lastSessionStatus}
                                            </Link>
                                        ) : (
                                            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass('DRAFT')}`}>
                                                DRAFT
                                            </span>
                                        )}
                                    </div>
                                    <div className="md:col-span-4 flex items-center text-sm text-gray-500">
                                        {group.lastSessionAt ? formatDateTimeCompact(group.lastSessionAt) : formatDateTimeCompact(group.updatedAt)}
                                    </div>
                                    <div className="md:col-span-4 flex items-center justify-end gap-1">
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
                                        <Link
                                            href={`/run-groups/${group.id}/history?projectId=${projectId}`}
                                            className="inline-flex items-center justify-center rounded-md p-2 text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
                                            title={t('runGroup.tooltip.history')}
                                            aria-label={t('runGroup.tooltip.history')}
                                        >
                                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </Link>
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
            </div>

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
