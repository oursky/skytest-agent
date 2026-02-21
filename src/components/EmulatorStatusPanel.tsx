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

function normalizeAvdName(name: string): string {
    return name.trim().toLowerCase();
}

const EMULATOR_STATE_LABEL_KEYS: Record<EmulatorPoolStatusItem['state'], string> = {
    STARTING: 'emulator.state.starting',
    BOOTING: 'emulator.state.booting',
    IDLE: 'emulator.state.idle',
    ACQUIRED: 'emulator.inUse',
    CLEANING: 'emulator.state.cleaning',
    STOPPING: 'emulator.state.stopping',
    DEAD: 'emulator.state.dead',
};

interface EmulatorStatusPanelProps {
    projectId: string;
}

export default function EmulatorStatusPanel({ projectId }: EmulatorStatusPanelProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [status, setStatus] = useState<EmulatorStatusResponse | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [requestFailed, setRequestFailed] = useState(false);
    const [stopping, setStopping] = useState<string | null>(null);
    const [bootingProfile, setBootingProfile] = useState<string | null>(null);
    const [bootingMode, setBootingMode] = useState<'window' | 'headless' | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    const fetchStatus = useCallback(async () => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/emulators?projectId=${encodeURIComponent(projectId)}`, { headers });
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
    }, [getAccessToken, projectId]);

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
        setActionError(null);
        setStopping(emulatorId);
        setStatus((current) => {
            if (!current) return current;
            return {
                ...current,
                emulators: current.emulators.map((emulator) =>
                    emulator.id === emulatorId
                        ? { ...emulator, state: 'STOPPING' }
                        : emulator
                ),
            };
        });
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            };
            const response = await fetch('/api/emulators', {
                method: 'POST',
                headers,
                body: JSON.stringify({ action: 'stop', emulatorId }),
            });
            if (!response.ok) {
                throw new Error('stop failed');
            }
            await fetchStatus();
        } catch {
            setActionError(t('emulator.actionFailed'));
            await fetchStatus();
        } finally {
            setStopping(null);
        }
    };

    const handleBoot = async (avdName: string, mode: 'window' | 'headless') => {
        setActionError(null);
        setBootingProfile(avdName);
        setBootingMode(mode);
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            };
            const response = await fetch('/api/emulators', {
                method: 'POST',
                headers,
                body: JSON.stringify({ action: 'boot', projectId, avdName, mode }),
            });
            if (!response.ok) {
                throw new Error('boot failed');
            }
            await fetchStatus();
        } catch {
            setActionError(t('emulator.actionFailed'));
            await fetchStatus();
        } finally {
            setBootingProfile(null);
            setBootingMode(null);
        }
    };

    const runtimeByAvd = new Map<string, EmulatorPoolStatusItem>();
    if (status) {
        for (const emulator of status.emulators) {
            const normalizedAvdName = normalizeAvdName(emulator.avdName);
            const existing = runtimeByAvd.get(normalizedAvdName);
            if (!existing || EMULATOR_STATE_PRIORITY[emulator.state] < EMULATOR_STATE_PRIORITY[existing.state]) {
                runtimeByAvd.set(normalizedAvdName, emulator);
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
            {actionError && (
                <div className="px-3 py-2 text-xs rounded border border-red-200 bg-red-50 text-red-700">
                    {actionError}
                </div>
            )}

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
                            const emulator = runtimeByAvd.get(normalizeAvdName(profile.name));
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
                                            {emulator ? t(EMULATOR_STATE_LABEL_KEYS[emulator.state]) : t('emulator.notRunning')}
                                        </span>
                                        {emulator && (
                                            <>
                                                <span className="text-xs text-gray-400">{formatUptime(emulator.uptimeMs)}</span>
                                                {emulator.memoryUsageMb && (
                                                    <span className="text-xs text-gray-400">{emulator.memoryUsageMb}MB</span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => void handleStop(emulator.id)}
                                                    disabled={stopping === emulator.id || emulator.state === 'STOPPING'}
                                                    className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                                                >
                                                    {stopping === emulator.id || emulator.state === 'STOPPING'
                                                        ? t('emulator.stopping')
                                                        : t('emulator.stop')}
                                                </button>
                                            </>
                                        )}
                                        {!emulator && (
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleBoot(profile.name, 'window')}
                                                    disabled={bootingProfile === profile.name}
                                                    className="text-xs px-2 py-1 text-blue-700 border border-blue-200 rounded hover:bg-blue-50 disabled:opacity-50"
                                                >
                                                    {bootingProfile === profile.name && bootingMode === 'window'
                                                        ? t('emulator.booting')
                                                        : t('emulator.bootWindow')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void handleBoot(profile.name, 'headless')}
                                                    disabled={bootingProfile === profile.name}
                                                    className="text-xs px-2 py-1 text-blue-700 border border-blue-200 rounded hover:bg-blue-50 disabled:opacity-50"
                                                >
                                                    {bootingProfile === profile.name && bootingMode === 'headless'
                                                        ? t('emulator.booting')
                                                        : t('emulator.bootHeadless')}
                                                </button>
                                            </div>
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
