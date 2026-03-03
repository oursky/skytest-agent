'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { buildAuthHeaders } from '@/components/features/configurations/model/config-utils';
import type { DeviceStatusResponse } from '../model/types';
import { buildDeviceSections } from '../model/build-device-sections';
import PhysicalDeviceRow from './PhysicalDeviceRow';
import EmulatorProfileRow from './EmulatorProfileRow';

interface DeviceStatusPanelProps {
    projectId: string;
}

export default function DeviceStatusPanel({ projectId }: DeviceStatusPanelProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [status, setStatus] = useState<DeviceStatusResponse | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [requestFailed, setRequestFailed] = useState(false);
    const [stoppingDevices, setStoppingDevices] = useState<Set<string>>(new Set());
    const [bootingProfiles, setBootingProfiles] = useState<Set<string>>(new Set());
    const [actionError, setActionError] = useState<string | null>(null);
    const [nowMs, setNowMs] = useState<number>(() => Date.now());
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const interval = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    const fetchStatus = useCallback(async () => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        try {
            const token = await getAccessToken();
            const res = await fetch(
                `/api/devices?projectId=${encodeURIComponent(projectId)}`,
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
            setForbidden(false);
            setRequestFailed(false);
            setStatus(await res.json() as DeviceStatusResponse);
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
            stopPolling();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [fetchStatus]);

    const handleStop = async ({ deviceId, serial }: { deviceId?: string; serial?: string }) => {
        const stopKey = deviceId ?? serial;
        if (!stopKey) {
            return;
        }

        setActionError(null);
        setStoppingDevices((current) => {
            const next = new Set(current);
            next.add(stopKey);
            return next;
        });

        if (deviceId) {
            setStatus((current) => {
                if (!current) return current;
                return {
                    ...current,
                    devices: current.devices.map((device) =>
                        device.id === deviceId
                            ? { ...device, state: 'STOPPING' }
                            : device
                    ),
                };
            });
        }

        try {
            const token = await getAccessToken();
            const response = await fetch('/api/devices', {
                method: 'POST',
                headers: buildAuthHeaders(token, true),
                body: JSON.stringify({
                    action: 'stop',
                    ...(deviceId ? { deviceId } : {}),
                    ...(serial ? { serial } : {}),
                }),
            });
            if (!response.ok) {
                throw new Error('stop failed');
            }
            await fetchStatus();
        } catch {
            setActionError(t('device.actionFailed'));
            await fetchStatus();
        } finally {
            setStoppingDevices((current) => {
                const next = new Set(current);
                next.delete(stopKey);
                return next;
            });
        }
    };

    const handleBoot = async (emulatorProfileName: string) => {
        setActionError(null);
        setBootingProfiles((current) => {
            const next = new Set(current);
            next.add(emulatorProfileName);
            return next;
        });

        try {
            const token = await getAccessToken();
            const response = await fetch('/api/devices', {
                method: 'POST',
                headers: buildAuthHeaders(token, true),
                body: JSON.stringify({ action: 'boot', emulatorProfileName }),
            });
            if (!response.ok) {
                throw new Error('boot failed');
            }
            await fetchStatus();
        } catch {
            setActionError(t('device.actionFailed'));
            await fetchStatus();
        } finally {
            setBootingProfiles((current) => {
                const next = new Set(current);
                next.delete(emulatorProfileName);
                return next;
            });
        }
    };

    const {
        connectedRuntimeBySerial,
        connectedPhysicalDevices,
        emulatorRows,
        showPhysicalSection,
        showEmulatorSection,
    } = useMemo(() => buildDeviceSections(status), [status]);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-gray-900">{t('device.panel.title')}</h2>
                    {status && (
                        <span className="text-xs text-gray-400">
                            {status.devices.length} active
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
                        {t('device.panel.empty')}
                    </div>
                ) : !status ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    </div>
                ) : status.connectedDevices.length === 0 && status.emulatorProfiles.length === 0 ? (
                    <div className="p-8 text-center text-sm text-gray-400">
                        {t('device.panel.empty')}
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {showPhysicalSection && (
                            <div className="px-4 py-2 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                                {t('device.section.connected')}
                            </div>
                        )}

                        {connectedPhysicalDevices.map((connected) => (
                            <PhysicalDeviceRow
                                key={connected.serial}
                                connected={connected}
                                runtime={connectedRuntimeBySerial.get(connected.serial)}
                                projectId={projectId}
                            />
                        ))}

                        {showEmulatorSection && (
                            <div className="px-4 py-2 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                                {t('device.section.profiles')}
                            </div>
                        )}

                        {emulatorRows.map((row) => (
                            <EmulatorProfileRow
                                key={row.key}
                                row={row}
                                projectId={projectId}
                                nowMs={nowMs}
                                stoppingDevices={stoppingDevices}
                                bootingProfiles={bootingProfiles}
                                onStop={handleStop}
                                onBoot={handleBoot}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
