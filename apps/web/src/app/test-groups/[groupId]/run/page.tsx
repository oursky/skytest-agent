'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { Breadcrumbs } from '@/components/layout';
import { isRunActiveStatus, type TestGroupSummary } from '@/types';

export default function TestGroupRunLauncherPage({ params }: { params: Promise<{ groupId: string }> }) {
    const { groupId } = use(params);
    const searchParams = useSearchParams();
    const projectId = searchParams.get('projectId');
    const { t } = useI18n();
    const { getAccessToken } = useAuth();
    const router = useRouter();
    const [group, setGroup] = useState<TestGroupSummary | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        if (!projectId) {
            return;
        }
        try {
            const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/test-groups/${groupId}`);
            if (response.status === 404) {
                setNotFound(true);
                return;
            }
            if (response.ok) {
                setGroup(await response.json() as TestGroupSummary);
            }
        } catch {
            // Keep loading state; the launcher just won't render until reachable.
        }
    }, [projectId, groupId, getAccessToken]);

    useEffect(() => { void load(); }, [load]);

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

    const isActive = isRunActiveStatus(group?.lastSessionStatus ?? null);
    const groupLabel = group ? `${group.displayId ? `${group.displayId} • ` : ''}${group.name}` : '';

    return (
        <main className="min-h-screen bg-gray-50">
            <div className="mx-auto max-w-3xl px-8 py-8">
                <Breadcrumbs items={[
                    { label: t('project.tab.testGroups'), href: projectId ? `/projects/${projectId}?tab=test-groups` : undefined },
                    { label: t('testGroup.run.title') },
                ]} />

                {notFound ? (
                    <p className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">{t('testGroup.run.notFound')}</p>
                ) : !group ? (
                    <p className="text-sm text-gray-500">{t('common.loading')}</p>
                ) : (
                    <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
                        <h1 className="text-2xl font-bold text-gray-900">{groupLabel}</h1>
                        <p className="mt-1 text-sm text-gray-500">{t('testGroup.caption')}</p>

                        <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-600">
                            <span>{t('testGroup.caseCount', { count: group.items.length })}</span>
                            {group.loginSessions.length > 0 && (
                                <span>{t('testGroup.loginSessions')}: {group.loginSessions.length}</span>
                            )}
                        </div>

                        <div className="mt-8">
                            {isActive && group.lastSessionId ? (
                                <Link
                                    href={`/test-groups/runs/${group.lastSessionId}?projectId=${projectId}`}
                                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                                >
                                    {t('testGroup.tooltip.viewRunning')}
                                </Link>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => { void handleRun(); }}
                                    disabled={starting || group.items.length === 0}
                                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {starting ? t('testGroup.running') : t('testGroup.run.start')}
                                </button>
                            )}
                        </div>

                        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                    </div>
                )}
            </div>
        </main>
    );
}
