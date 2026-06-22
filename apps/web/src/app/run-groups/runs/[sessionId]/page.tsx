'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { getStatusBadgeClass } from '@/utils/status/statusBadge';
import { isRunTerminalStatus } from '@/types';

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

    useEffect(() => {
        if (!projectId) return;
        let active = true;
        let timer: ReturnType<typeof setInterval> | null = null;
        const tick = async () => {
            try {
                const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/run-sessions/${sessionId}`);
                if (!active) return;
                if (response.status === 404) {
                    setNotFound(true);
                    if (timer) clearInterval(timer);
                    return;
                }
                if (response.ok) {
                    const data = await response.json() as SessionView;
                    if (!active) return;
                    setSession(data);
                    if (isRunTerminalStatus(data.status) && timer) {
                        clearInterval(timer);
                    }
                }
            } catch {
                // Transient; the next poll retries.
            }
        };
        void tick();
        timer = setInterval(() => { void tick(); }, 2500);
        return () => { active = false; if (timer) clearInterval(timer); };
    }, [projectId, sessionId, getAccessToken]);

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
                        <div className="flex items-center gap-3">
                            <h1 className="text-lg font-semibold text-gray-900">{t('runGroup.run.title')}</h1>
                            <span className={`rounded border px-2 py-0.5 text-xs ${getStatusBadgeClass(session.status)}`}>{session.status}</span>
                        </div>
                        <ol className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                            {session.members.map((member) => (
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
                                    <span className={`rounded border px-2 py-0.5 text-xs ${getStatusBadgeClass(member.status)}`}>{member.status}</span>
                                    <Link href={`/test-cases/${member.testCaseId}/history/${member.runId}`} className="text-xs text-gray-500 hover:text-primary">{t('runGroup.run.viewMember')}</Link>
                                </li>
                            ))}
                        </ol>
                    </div>
                )}
            </div>
        </main>
    );
}
