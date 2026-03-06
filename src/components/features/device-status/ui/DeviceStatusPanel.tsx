'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { buildAuthHeaders } from '@/components/features/configurations/model/config-utils';

interface ProjectDevice {
    id: string;
    runnerId: string;
    runnerLabel: string;
    deviceId: string;
    name: string;
    platform: string;
    state: string;
    lastSeenAt: string;
    isFresh: boolean;
    isAvailable: boolean;
}

interface ProjectDevicesResponse {
    projectId: string;
    runnerConnected: boolean;
    availableDeviceCount: number;
    staleDeviceCount: number;
    devices: ProjectDevice[];
    refreshedAt: string;
}

interface DeviceStatusPanelProps {
    projectId: string;
}

function buildDeviceStateLabel(device: ProjectDevice, t: (key: string) => string): string {
    if (device.state === 'ONLINE' && !device.isFresh) {
        return t('device.state.stale');
    }
    if (device.state === 'ONLINE') {
        return t('device.state.online');
    }
    if (device.state === 'UNAVAILABLE') {
        return t('device.state.unavailable');
    }
    return t('device.state.offline');
}

function buildDeviceStateClass(device: ProjectDevice): string {
    if (device.state === 'ONLINE' && device.isFresh && device.isAvailable) {
        return 'bg-green-100 text-green-700';
    }
    if (device.state === 'ONLINE' && !device.isFresh) {
        return 'bg-amber-100 text-amber-700';
    }
    if (device.state === 'UNAVAILABLE') {
        return 'bg-red-100 text-red-700';
    }
    return 'bg-gray-100 text-gray-600';
}

export default function DeviceStatusPanel({ projectId }: DeviceStatusPanelProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [status, setStatus] = useState<ProjectDevicesResponse | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [requestFailed, setRequestFailed] = useState(false);
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    const fetchStatus = useCallback(async () => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
            return;
        }

        try {
            const token = await getAccessToken();
            const res = await fetch(
                `/api/projects/${encodeURIComponent(projectId)}/devices`,
                { headers: buildAuthHeaders(token) }
            );
            if (res.status === 403) {
                setForbidden(true);
                setRequestFailed(false);
                return;
            }
            if (!res.ok) {
                setRequestFailed(true);
                return;
            }

            const payload = await res.json() as ProjectDevicesResponse;
            setForbidden(false);
            setRequestFailed(false);
            setStatus(payload);
        } catch {
            setRequestFailed(true);
        }
    }, [getAccessToken, projectId]);

    useEffect(() => {
        const initialFetchTimer = setTimeout(() => {
            void fetchStatus();
        }, 0);

        const startPolling = () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
            }
            pollRef.current = setInterval(() => void fetchStatus(), 15_000);
        };

        const stopPolling = () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
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
            clearTimeout(initialFetchTimer);
            stopPolling();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [fetchStatus]);

    const availableDevices = status?.devices.filter((device) => device.isAvailable) ?? [];

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-gray-900">{t('device.panel.title')}</h2>
                    {status && (
                        <span className="text-xs text-gray-400">
                            {t('device.panel.availableCount', { count: String(status.availableDeviceCount) })}
                        </span>
                    )}
                </div>
                {status && (
                    <span className="text-xs text-gray-400">
                        {t('device.panel.refreshedAt', { time: new Date(status.refreshedAt).toLocaleTimeString() })}
                    </span>
                )}
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {forbidden ? (
                    <div className="p-4 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200">
                        {t('feature.android.disabled')}
                    </div>
                ) : requestFailed && !status ? (
                    <div className="p-8 text-center text-sm text-gray-400">
                        {t('device.panel.empty')}
                    </div>
                ) : !status ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    </div>
                ) : !status.runnerConnected ? (
                    <div className="p-8 text-center text-sm text-gray-500">
                        {t('device.panel.noRunner')}
                    </div>
                ) : availableDevices.length === 0 ? (
                    <div className="p-8 text-center text-sm text-gray-500">
                        {t('device.panel.noAvailableDevices')}
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {status.staleDeviceCount > 0 && (
                            <div className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
                                {t('device.panel.staleWarning', { count: String(status.staleDeviceCount) })}
                            </div>
                        )}

                        {availableDevices.map((device) => (
                            <div key={device.id} className="px-4 py-3 flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-gray-900 truncate">
                                        {device.name}
                                    </p>
                                    <p className="text-xs text-gray-500 truncate">
                                        {device.deviceId}
                                    </p>
                                    <p className="text-xs text-gray-400 truncate">
                                        {t('device.panel.lastSeen', { time: new Date(device.lastSeenAt).toLocaleTimeString() })}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-gray-500">
                                        {device.runnerLabel}
                                    </p>
                                    <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full ${buildDeviceStateClass(device)}`}>
                                        {buildDeviceStateLabel(device, t)}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
