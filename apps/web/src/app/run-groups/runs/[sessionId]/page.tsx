'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { getStatusBadgeClass } from '@/utils/status/statusBadge';
import { Button, LoadingSpinner, Modal } from '@/components/shared';
import { isRunActiveStatus, isRunTerminalStatus } from '@/types';

interface SessionMemberView {
    runId: string;
    testCaseId: string;
    kind: string;
    sessionPosition: number | null;
    status: string;
    reusedSession: boolean;
    displayId?: string | null;
    name: string;
}

interface SessionView {
    id: string;
    kind: string;
    status: string;
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
    const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
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

    const handleCancelMember = async (runId: string) => {
        setCancellingRunId(runId);
        try {
            await fetchWithAccessToken(getAccessToken, `/api/test-runs/${runId}/cancel`, { method: 'POST' });
            await load();
        } catch {
            // The poll will reconcile.
        } finally {
            setCancellingRunId(null);
        }
    };

    const sessionActive = isRunActiveStatus(session?.status);
    const settledCount = session?.members.filter((m) => isRunTerminalStatus(m.status)).length ?? 0;
    const totalCount = session?.members.length ?? 0;

    return (
        <main className="min-h-screen bg-gray-50">
            <div className="mx-auto max-w-3xl px-4 py-8">
                <div className="mb-4 flex items-center gap-3">
                    {projectId && (
                        <Link href={`/projects/${projectId}?tab=run-groups`} className="text-sm text-gray-500 hover:text-primary">← {t('runGroup.title')}</Link>
                    )}
                </div>
                {notFound ? (
                    <p className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">{t('runGroup.run.notFound')}</p>
                ) : !session ? (
                    <p className="text-sm text-gray-500">{t('common.loading')}</p>
                ) : (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-lg font-semibold text-gray-900">{t('runGroup.run.title')}</h1>
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(session.status)}`}>{session.status}</span>
                            <span className="text-xs text-gray-500">{t('runGroup.run.progress', { done: settledCount, total: totalCount })}</span>
                            <div className="ml-auto">
                                {sessionActive && (
                                    <Button type="button" variant="danger" size="sm" onClick={() => setConfirmStop(true)} disabled={stopping}>
                                        {stopping ? t('runGroup.run.stopping') : t('runGroup.run.stop')}
                                    </Button>
                                )}
                            </div>
                        </div>
                        <ol className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                            {session.members.map((member) => {
                                const memberActive = isRunActiveStatus(member.status);
                                return (
                                    <li key={member.runId} className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
                                        <span className="w-5 text-xs text-gray-400">{(member.sessionPosition ?? 0) + 1}</span>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                {member.displayId && <span className="font-mono text-xs text-gray-500">{member.displayId}</span>}
                                                <span className="truncate text-sm text-gray-900">{member.name}</span>
                                                {member.kind === 'LOGIN_FLOW' && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">{t('project.tab.loginFlows')}</span>}
                                                {member.reusedSession && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{t('runGroup.run.reused')}</span>}
                                            </div>
                                        </div>
                                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(member.status)}`}>{member.status}</span>
                                        {memberActive ? (
                                            <button
                                                type="button"
                                                onClick={() => { void handleCancelMember(member.runId); }}
                                                disabled={cancellingRunId === member.runId}
                                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                                            >
                                                {cancellingRunId === member.runId ? <LoadingSpinner size={12} /> : null}
                                                {t('runGroup.run.cancelMember')}
                                            </button>
                                        ) : (
                                            <Link href={`/test-cases/${member.testCaseId}/history/${member.runId}`} className="rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary">{t('runGroup.run.viewMember')}</Link>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
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
