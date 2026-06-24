'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { getStatusBadgeClass } from '@/utils/status/statusBadge';
import { formatDateTime } from '@/utils/time/dateFormatter';
import { Breadcrumbs } from '@/components/layout';
import type { TestGroupRunPreview } from '@/types';

export default function TestGroupRunLauncherPage({ params }: { params: Promise<{ groupId: string }> }) {
    const { groupId } = use(params);
    const searchParams = useSearchParams();
    const projectId = searchParams.get('projectId');
    const { t } = useI18n();
    const { getAccessToken } = useAuth();
    const router = useRouter();
    const [preview, setPreview] = useState<TestGroupRunPreview | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        if (!projectId) {
            return;
        }
        try {
            const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/test-groups/${groupId}/run-preview`);
            if (response.status === 404) {
                setNotFound(true);
                return;
            }
            if (response.ok) {
                setPreview(await response.json() as TestGroupRunPreview);
            }
        } catch {
            // Keep loading state; the launcher just won't render until reachable.
        }
    }, [projectId, groupId, getAccessToken]);

    useEffect(() => { void load(); }, [load]);

    const activeSessionId = preview?.activeSessionId ?? null;

    // Keep the Start / View-running toggle honest: poll while a session is active (so the
    // button reverts to Start once it completes) and refresh on focus (so a session started
    // elsewhere is reflected instead of a stale Start that 409s).
    useEffect(() => {
        const onFocus = () => { void load(); };
        window.addEventListener('focus', onFocus);
        const interval = activeSessionId ? setInterval(() => { void load(); }, 5000) : null;
        return () => {
            window.removeEventListener('focus', onFocus);
            if (interval) clearInterval(interval);
        };
    }, [activeSessionId, load]);

    const handleRun = async () => {
        if (!projectId) return;
        setStarting(true);
        setError('');
        try {
            const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/test-groups/${groupId}/run`, { method: 'POST' });
            const body = await response.json().catch(() => null) as { sessionId?: string; error?: string } | null;
            if (!response.ok || !body?.sessionId) {
                setError(body?.error ?? t('testGroup.error.runFailed'));
                return;
            }
            router.push(`/test-groups/runs/${body.sessionId}?projectId=${projectId}`);
        } catch {
            setError(t('testGroup.error.runFailed'));
        } finally {
            setStarting(false);
        }
    };

    const groupLabel = preview ? `${preview.displayId ? `${preview.displayId} • ` : ''}${preview.name}` : '';

    return (
        <main className="min-h-screen bg-gray-50">
            <div className="mx-auto max-w-7xl px-8 py-8">
                <Breadcrumbs items={[
                    { label: t('project.tab.testGroups'), href: projectId ? `/projects/${projectId}?tab=test-groups` : undefined },
                    { label: t('testGroup.run.title') },
                ]} />

                {notFound ? (
                    <p className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">{t('testGroup.run.notFound')}</p>
                ) : !preview ? (
                    <p className="text-sm text-gray-500">{t('common.loading')}</p>
                ) : (
                    <>
                        <div className="mb-8 flex flex-wrap items-center gap-3">
                            <h1 className="text-3xl font-bold text-gray-900">{groupLabel}</h1>
                            <span className="text-sm text-gray-500">{t('testGroup.caseCount', { count: preview.members.filter((m) => m.kind === 'TEST').length })}</span>
                            <div className="ml-auto">
                                {activeSessionId ? (
                                    <Link
                                        href={`/test-groups/runs/${activeSessionId}?projectId=${projectId}`}
                                        className="inline-flex items-center justify-center rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                                    >
                                        {t('testGroup.tooltip.viewRunning')}
                                    </Link>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => { void handleRun(); }}
                                        disabled={starting || preview.members.length === 0}
                                        className="inline-flex items-center justify-center rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {starting ? t('testGroup.running') : t('testGroup.run.start')}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                            <div className="hidden grid-cols-12 items-center gap-4 border-b border-gray-200 bg-gray-50 p-4 text-sm font-medium text-gray-500 md:grid">
                                <div className="col-span-6">{t('history.table.testCase')}</div>
                                <div className="col-span-2">{t('history.table.status')}</div>
                                <div className="col-span-2">{t('history.table.started')}</div>
                                <div className="col-span-2 flex justify-end">{t('history.table.actions')}</div>
                            </div>
                            <div className="divide-y divide-gray-100">
                                {preview.members.map((member) => (
                                    <div key={member.testCaseId} className="grid grid-cols-1 items-center gap-4 p-4 transition-colors hover:bg-gray-50 md:grid-cols-12">
                                        <div className="flex min-w-0 items-center gap-2 md:col-span-6">
                                            <span className="w-5 shrink-0 text-xs text-gray-400">{member.position + 1}</span>
                                            <span className="min-w-0 flex items-center gap-2">
                                                {member.displayId && <span className="font-mono text-xs text-gray-500">{member.displayId}</span>}
                                                <span className="truncate text-sm font-medium text-gray-900">{member.name}</span>
                                            </span>
                                            {member.kind === 'LOGIN_FLOW' && <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">{t('configs.browser.loginFlow')}</span>}
                                        </div>
                                        <div className="md:col-span-2">
                                            {member.status ? (
                                                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(member.status)}`}>{member.status}</span>
                                            ) : (
                                                <span className="text-sm text-gray-400">—</span>
                                            )}
                                        </div>
                                        <div className="text-sm text-gray-500 md:col-span-2">{member.startedAt ? formatDateTime(member.startedAt) : '—'}</div>
                                        <div className="md:col-span-2" />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                    </>
                )}
            </div>
        </main>
    );
}
