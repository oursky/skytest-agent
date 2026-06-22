'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { getStatusBadgeClass } from '@/utils/status/statusBadge';
import { formatDateTime } from '@/utils/time/dateFormatter';
import { Button, Modal } from '@/components/shared';
import { Breadcrumbs } from '@/components/layout';
import { isRunActiveStatus, isRunTerminalStatus, TEST_STATUS } from '@/types';

interface SessionMemberView {
    runId: string;
    testCaseId: string;
    kind: string;
    sessionPosition: number | null;
    status: string;
    reusedSession: boolean;
    startedAt: string;
    displayId?: string | null;
    name: string;
}

interface SessionView {
    id: string;
    kind: string;
    status: string;
    runGroupId: string | null;
    projectName: string;
    groupName: string | null;
    members: SessionMemberView[];
}

export default function RunGroupRunPage({ params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = use(params);
    const searchParams = useSearchParams();
    const projectId = searchParams.get('projectId');
    const { t } = useI18n();
    const { getAccessToken } = useAuth();
    const [session, setSession] = useState<SessionView | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [confirmStop, setConfirmStop] = useState(false);

    const load = useCallback(async () => {
        if (!projectId) return null;
        const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/run-sessions/${sessionId}`);
        if (response.status === 404) {
            setNotFound(true);
            return null;
        }
        if (response.ok) {
            const data = await response.json() as SessionView;
            setSession(data);
            return data;
        }
        return null;
    }, [projectId, sessionId, getAccessToken]);

    useEffect(() => {
        if (!projectId) return;
        let active = true;
        let timer: ReturnType<typeof setInterval> | null = null;
        const tick = async () => {
            try {
                const data = await load();
                if (!active) return;
                if (data && isRunTerminalStatus(data.status) && timer) {
                    clearInterval(timer);
                }
            } catch {
                // Transient; the next poll retries.
            }
        };
        void tick();
        timer = setInterval(() => { void tick(); }, 2500);
        return () => { active = false; if (timer) clearInterval(timer); };
    }, [projectId, load]);

    const handleStopGroup = async () => {
        if (!projectId) return;
        setConfirmStop(false);
        setStopping(true);
        try {
            await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/run-sessions/${sessionId}`, { method: 'POST' });
            await load();
        } catch {
            // Surface nothing here; the poll will reflect the real state.
        } finally {
            setStopping(false);
        }
    };

    const sessionActive = isRunActiveStatus(session?.status);
    const settledCount = session?.members.filter((m) => isRunTerminalStatus(m.status)).length ?? 0;
    const totalCount = session?.members.length ?? 0;

    return (
        <main className="min-h-screen bg-gray-50">
            <div className="mx-auto max-w-7xl px-8 py-8">
                <Breadcrumbs items={[
                    { label: session?.projectName ?? '', href: projectId ? `/projects/${projectId}?tab=run-groups` : undefined },
                    ...(session?.runGroupId
                        ? [{ label: session.groupName ?? '', href: `/run-groups/${session.runGroupId}/history?projectId=${projectId ?? ''}` }]
                        : []),
                    { label: t('runGroup.run.title') },
                ]} />

                {notFound ? (
                    <p className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">{t('runGroup.run.notFound')}</p>
                ) : !session ? (
                    <p className="text-sm text-gray-500">{t('common.loading')}</p>
                ) : (
                    <>
                        <div className="mb-8 flex flex-wrap items-center gap-3">
                            <h1 className="text-3xl font-bold text-gray-900">{t('runGroup.run.title')}</h1>
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(session.status)}`}>{session.status}</span>
                            <span className="text-sm text-gray-500">{t('runGroup.run.progress', { done: settledCount, total: totalCount })}</span>
                            {sessionActive && (
                                <div className="ml-auto">
                                    <Button type="button" variant="danger" size="sm" onClick={() => setConfirmStop(true)} disabled={stopping}>
                                        {stopping ? t('runGroup.run.stopping') : t('runGroup.run.stop')}
                                    </Button>
                                </div>
                            )}
                        </div>

                        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                            <div className="hidden grid-cols-12 items-center gap-4 border-b border-gray-200 bg-gray-50 p-4 text-sm font-medium text-gray-500 md:grid">
                                <div className="col-span-6">{t('history.table.testCase')}</div>
                                <div className="col-span-2">{t('history.table.status')}</div>
                                <div className="col-span-2">{t('history.table.started')}</div>
                                <div className="col-span-2 flex justify-end">{t('history.table.actions')}</div>
                            </div>
                            <div className="divide-y divide-gray-100">
                                {session.members.map((member) => {
                                    const memberActive = isRunActiveStatus(member.status);
                                    const stopLabel = member.status === TEST_STATUS.QUEUED ? t('run.button.quitQueue') : t('run.button.stopTest');
                                    return (
                                        <div key={member.runId} className="grid grid-cols-1 items-center gap-4 p-4 transition-colors hover:bg-gray-50 md:grid-cols-12">
                                            <div className="flex min-w-0 items-center gap-2 md:col-span-6">
                                                <span className="w-5 shrink-0 text-xs text-gray-400">{(member.sessionPosition ?? 0) + 1}</span>
                                                <Link href={`/test-cases/${member.testCaseId}/history/${member.runId}`} className="min-w-0 flex items-center gap-2 hover:text-primary">
                                                    {member.displayId && <span className="font-mono text-xs text-gray-500">{member.displayId}</span>}
                                                    <span className="truncate text-sm font-medium text-gray-900">{member.name}</span>
                                                </Link>
                                                {member.kind === 'LOGIN_FLOW' && <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">{t('project.tab.loginFlows')}</span>}
                                                {member.reusedSession && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{t('runGroup.run.reused')}</span>}
                                            </div>
                                            <div className="md:col-span-2">
                                                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(member.status)}`}>{member.status}</span>
                                            </div>
                                            <div className="text-sm text-gray-500 md:col-span-2">{formatDateTime(member.startedAt)}</div>
                                            <div className="flex items-center justify-end md:col-span-2">
                                                {memberActive ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setConfirmStop(true)}
                                                        disabled={stopping}
                                                        className="inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
                                                    >
                                                        {stopLabel}
                                                    </button>
                                                ) : (
                                                    <Link href={`/test-cases/${member.testCaseId}/history/${member.runId}`} className="inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-blue-50 hover:text-primary/80">
                                                        {t('history.viewDetails')}
                                                    </Link>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
            </div>
            <Modal
                isOpen={confirmStop}
                onClose={() => setConfirmStop(false)}
                title={t('runGroup.run.stopConfirmTitle')}
                confirmText={t('runGroup.run.stop')}
                cancelText={t('common.cancel')}
                confirmVariant="danger"
                onConfirm={() => { void handleStopGroup(); }}
                closeOnConfirm={false}
            >
                <p className="text-sm text-gray-600">{t('runGroup.run.stopConfirmBody')}</p>
            </Modal>
        </main>
    );
}
