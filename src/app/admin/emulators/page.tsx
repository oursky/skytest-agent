'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/auth-provider';
import type { EmulatorPoolStatus } from '@/lib/emulator-pool';
import { EMULATOR_STATE_COLORS } from '@/utils/emulatorColors';
import { formatUptime } from '@/utils/dateFormatter';

export default function AdminEmulatorsPage() {
    const { getAccessToken } = useAuth();
    const [status, setStatus] = useState<EmulatorPoolStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [stopping, setStopping] = useState<string | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch('/api/admin/emulators', { headers });
            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string };
                setError(data.error || 'Failed to load emulator status');
                return;
            }
            setStatus(await res.json() as EmulatorPoolStatus);
            setError(null);
        } catch {
            setError('Failed to connect to server');
        }
    }, [getAccessToken]);

    useEffect(() => {
        void fetchStatus();
        const interval = setInterval(() => void fetchStatus(), 5000);
        return () => clearInterval(interval);
    }, [fetchStatus]);

    const handleStop = async (emulatorId: string) => {
        setStopping(emulatorId);
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            };
            await fetch('/api/admin/emulators', {
                method: 'POST',
                headers,
                body: JSON.stringify({ action: 'stop', emulatorId }),
            });
            await fetchStatus();
        } finally {
            setStopping(null);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Emulator Pool</h1>
                        <p className="text-sm text-gray-500 mt-1">Android emulator instance management</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void fetchStatus()}
                        className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-1.5"
                    >
                        <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Refresh
                    </button>
                </div>

                {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                        {error}
                    </div>
                )}

                {status && (
                    <>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-white p-4 rounded-lg border border-gray-200">
                                <div className="text-2xl font-bold text-gray-900">{status.emulators.length}</div>
                                <div className="text-sm text-gray-500 mt-1">Active Emulators</div>
                            </div>
                            <div className="bg-white p-4 rounded-lg border border-gray-200">
                                <div className="text-2xl font-bold text-gray-900">{status.maxEmulators}</div>
                                <div className="text-sm text-gray-500 mt-1">Max Instances</div>
                            </div>
                            <div className="bg-white p-4 rounded-lg border border-gray-200">
                                <div className="text-2xl font-bold text-gray-900">{status.waitingRequests}</div>
                                <div className="text-sm text-gray-500 mt-1">Queued Requests</div>
                            </div>
                        </div>

                        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                                <span className="text-sm font-semibold text-gray-700">Emulator Instances</span>
                            </div>
                            {status.emulators.length === 0 ? (
                                <div className="p-8 text-center text-sm text-gray-400">
                                    No active emulators
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-100">
                                    {status.emulators.map((emulator) => (
                                        <div key={emulator.id} className="px-4 py-3 flex items-center justify-between gap-4">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <span className="text-lg">📱</span>
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium text-gray-900 truncate">{emulator.avdName}</div>
                                                    <div className="text-xs text-gray-400 font-mono">{emulator.id}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${EMULATOR_STATE_COLORS[emulator.state]}`}>
                                                    {emulator.state}
                                                </span>
                                                {emulator.runId && (
                                                    <span className="text-xs text-gray-500 font-mono truncate max-w-[120px]" title={emulator.runId}>
                                                        run: {emulator.runId.slice(0, 8)}…
                                                    </span>
                                                )}
                                                <span className="text-xs text-gray-400">{formatUptime(emulator.uptimeMs)}</span>
                                                {emulator.memoryUsageMb && (
                                                    <span className="text-xs text-gray-400">{emulator.memoryUsageMb}MB</span>
                                                )}
                                                {(emulator.state === 'IDLE' || emulator.state === 'BOOTING') && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleStop(emulator.id)}
                                                        disabled={stopping === emulator.id}
                                                        className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                                                    >
                                                        {stopping === emulator.id ? 'Stopping…' : 'Stop'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {!status && !error && (
                    <div className="flex justify-center py-12 text-sm text-gray-400">
                        Loading…
                    </div>
                )}
            </div>
        </div>
    );
}
