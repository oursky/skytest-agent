'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { EmulatorPoolStatus, EmulatorPoolStatusItem } from '@/lib/emulator-pool';
import { EMULATOR_STATE_COLORS } from '@/utils/emulatorColors';
import { formatUptime } from '@/utils/dateFormatter';

interface EmulatorStatusResponse extends EmulatorPoolStatus {
    avdProfiles: Array<{
        id: string;
        name: string;
        displayName: string;
        apiLevel: number | null;
        screenSize: string | null;
    }>;
}

const EMULATOR_STATE_PRIORITY: Record<EmulatorPoolStatusItem['state'], number> = {
    ACQUIRED: 0,
    CLEANING: 1,
    IDLE: 2,
    BOOTING: 3,
    STARTING: 4,
    STOPPING: 5,
    DEAD: 6,
};

export default function EmulatorStatusPanel() {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [status, setStatus] = useState<EmulatorStatusResponse | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [requestFailed, setRequestFailed] = useState(false);
    const [stopping, setStopping] = useState<string | null>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    const fetchStatus = useCallback(async () => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch('/api/emulators', { headers });
            if (res.status === 403) {
                setForbidden(true);
                setRequestFailed(false);
                return;
            }
            if (!res.ok) {
                setRequestFailed(true);
                return;
            }
            setForbidden(false);
            setRequestFailed(false);
            setStatus(await res.json() as EmulatorStatusResponse);
        } catch {
            setRequestFailed(true);
        }
    }, [getAccessToken]);

    useEffect(() => {
        void fetchStatus();

        const startPolling = () => {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = setInterval(() => void fetchStatus(), 15_000);
        };

        const stopPolling = () => {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        };

        startPolling();

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void fetchStatus();
                startPolling();
            } else {
                stopPolling();
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            stopPolling();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [fetchStatus]);

    const handleStop = async (emulatorId: string) => {
        setStopping(emulatorId);
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            };
            await fetch('/api/emulators', {
                method: 'POST',
                headers,
                body: JSON.stringify({ action: 'stop', emulatorId }),
            });
            await fetchStatus();
        } finally {
            setStopping(null);
        }
    };

    const runtimeByAvd = new Map<string, EmulatorPoolStatusItem>();
    if (status) {
        for (const emulator of status.emulators) {
            const existing = runtimeByAvd.get(emulator.avdName);
            if (!existing || EMULATOR_STATE_PRIORITY[emulator.state] < EMULATOR_STATE_PRIORITY[existing.state]) {
                runtimeByAvd.set(emulator.avdName, emulator);
            }
        }
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-gray-900">{t('emulator.panel.title')}</h2>
                    {status && (
                        <span className="text-xs text-gray-400">
                            {status.emulators.length} active
                            {status.waitingRequests > 0 && ` · ${t('emulator.waiting', { n: status.waitingRequests })}`}
                        </span>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {forbidden ? (
                    <div className="p-4 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200">
                        {t('feature.android.disabled')}
                    </div>
                ) : requestFailed && !status ? (
                    <div className="p-8 text-center text-sm text-gray-400">
                        {t('emulator.panel.empty')}
                    </div>
                ) : !status ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    </div>
                ) : status.avdProfiles.length === 0 ? (
                    <div className="p-8 text-center text-sm text-gray-400">
                        {t('emulator.panel.empty')}
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {status.avdProfiles.map((profile) => {
                            const emulator = runtimeByAvd.get(profile.name);
                            return (
                            <div key={profile.name} className="px-4 py-3">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium text-gray-900 truncate">{profile.name}</div>
                                            {emulator && (
                                                <div className="text-xs text-gray-400 font-mono">{emulator.id}</div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${emulator ? EMULATOR_STATE_COLORS[emulator.state] : 'bg-gray-100 text-gray-600'}`}>
                                            {emulator ? (emulator.state === 'ACQUIRED' ? t('emulator.inUse') : emulator.state) : t('emulator.notRunning')}
                                        </span>
                                        {emulator && (
                                            <>
                                                <span className="text-xs text-gray-400">{formatUptime(emulator.uptimeMs)}</span>
                                                {emulator.memoryUsageMb && (
                                                    <span className="text-xs text-gray-400">{emulator.memoryUsageMb}MB</span>
                                                )}
                                                {(emulator.state === 'IDLE' || emulator.state === 'BOOTING' || emulator.state === 'STARTING') && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleStop(emulator.id)}
                                                        disabled={stopping === emulator.id}
                                                        className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                                                    >
                                                        {stopping === emulator.id ? 'Stopping…' : t('emulator.stop')}
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                                {emulator?.state === 'ACQUIRED' && emulator.runTestCaseId && (
                                    <div className="mt-1.5 ml-0.5">
                                        <Link
                                            href={`/test-cases/${emulator.runTestCaseId}/history/${emulator.runId}`}
                                            className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                        >
                                            → {emulator.runTestCaseDisplayId ?? t('emulator.testRun')} &ldquo;{emulator.runTestCaseName}&rdquo;
                                        </Link>
                                    </div>
                                )}
                            </div>
                        )})}
                    </div>
                )}
            </div>
        </div>
    );
}
