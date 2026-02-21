'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { EmulatorPoolStatus } from '@/lib/emulator-pool';
import { EMULATOR_STATE_COLORS } from '@/utils/emulatorColors';
import { formatUptime } from '@/utils/dateFormatter';

interface AvdProfile {
    name: string;
    displayName: string;
}

interface EmulatorStatusPanelProps {
    projectId: string;
}

export default function EmulatorStatusPanel({ projectId }: EmulatorStatusPanelProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [status, setStatus] = useState<EmulatorPoolStatus | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [stopping, setStopping] = useState<string | null>(null);
    const [avdProfiles, setAvdProfiles] = useState<AvdProfile[]>([]);
    const [selectedAvd, setSelectedAvd] = useState('');
    const [booting, setBooting] = useState(false);
    const [avdDropdownOpen, setAvdDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    const fetchStatus = useCallback(async () => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch('/api/emulators', { headers });
            if (res.status === 403) { setForbidden(true); return; }
            if (!res.ok) return;
            setStatus(await res.json() as EmulatorPoolStatus);
        } catch {
            // ignore
        }
    }, [getAccessToken]);

    const fetchAvdProfiles = useCallback(async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/projects/${projectId}/avd-profiles`, { headers });
            if (res.ok) {
                const data = await res.json() as AvdProfile[];
                setAvdProfiles(data);
                if (data.length > 0) setSelectedAvd(data[0].name);
            }
        } catch {
            // ignore
        }
    }, [projectId, getAccessToken]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setAvdDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        void fetchStatus();
        void fetchAvdProfiles();

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
    }, [fetchStatus, fetchAvdProfiles]);

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

    const handleBoot = async () => {
        if (!selectedAvd) return;
        setBooting(true);
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            };
            await fetch('/api/emulators', {
                method: 'POST',
                headers,
                body: JSON.stringify({ action: 'boot', avdName: selectedAvd, projectId }),
            });
            await fetchStatus();
        } finally {
            setBooting(false);
        }
    };

    if (forbidden) return null;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-gray-900">{t('emulator.panel.title')}</h2>
                    {status && (
                        <span className="text-xs text-gray-400">
                            {status.emulators.length} / {status.maxEmulators} active
                            {status.waitingRequests > 0 && ` · ${t('emulator.waiting', { n: status.waitingRequests })}`}
                        </span>
                    )}
                </div>
                {avdProfiles.length > 0 && (
                    <div className="flex items-center gap-2">
                        <div className="relative" ref={dropdownRef}>
                            <button
                                type="button"
                                onClick={() => setAvdDropdownOpen(prev => !prev)}
                                className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-md px-2.5 py-1.5 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                <span>{avdProfiles.find(p => p.name === selectedAvd)?.displayName ?? selectedAvd}</span>
                                <svg className={`w-4 h-4 text-gray-400 transition-transform ${avdDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {avdDropdownOpen && (
                                <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-10">
                                    {avdProfiles.map(p => (
                                        <button
                                            key={p.name}
                                            type="button"
                                            onClick={() => { setSelectedAvd(p.name); setAvdDropdownOpen(false); }}
                                            className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${p.name === selectedAvd ? 'text-primary font-medium' : 'text-gray-700'}`}
                                        >
                                            {p.displayName}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => void handleBoot()}
                            disabled={booting || !selectedAvd}
                            className="px-3 py-1.5 text-sm bg-primary text-white rounded-md hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                            {booting ? (
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                            ) : null}
                            {t('emulator.boot')}
                        </button>
                    </div>
                )}
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {!status ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    </div>
                ) : status.emulators.length === 0 ? (
                    <div className="p-8 text-center text-sm text-gray-400">
                        {t('emulator.panel.empty')}
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {status.emulators.map(emulator => (
                            <div key={emulator.id} className="px-4 py-3 flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-gray-900 truncate">{emulator.avdName}</div>
                                        <div className="text-xs text-gray-400 font-mono">{emulator.id}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${EMULATOR_STATE_COLORS[emulator.state]}`}>
                                        {emulator.state === 'ACQUIRED' ? t('emulator.inUse') : emulator.state}
                                    </span>
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
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
