'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { AndroidDevicePoolStatus, AndroidDevicePoolStatusItem } from '@/lib/android-device-manager';
import type { ConnectedAndroidDeviceInfo } from '@/lib/android-devices';
import { formatAndroidDeviceDisplayName } from '@/lib/android-devices';
import { DEVICE_STATE_COLORS } from '@/utils/deviceStateColors';

interface DeviceStatusResponse extends AndroidDevicePoolStatus {
    connectedDevices: ConnectedAndroidDeviceInfo[];
    emulatorProfiles: Array<{
        id: string;
        name: string;
        displayName: string;
        apiLevel: number | null;
        screenSize: string | null;
    }>;
}

const DEVICE_STATE_PRIORITY: Record<AndroidDevicePoolStatusItem['state'], number> = {
    ACQUIRED: 0,
    CLEANING: 1,
    IDLE: 2,
    BOOTING: 3,
    STARTING: 4,
    STOPPING: 5,
    DEAD: 6,
};

function normalizeName(name: string): string {
    return name.trim().toLowerCase();
}

function isDeviceInUseByCurrentProject(device: AndroidDevicePoolStatusItem, projectId: string): boolean {
    return device.state === 'ACQUIRED' && device.runProjectId === projectId;
}

const DEVICE_STATE_LABEL_KEYS: Record<Exclude<AndroidDevicePoolStatusItem['state'], 'ACQUIRED'>, string> = {
    STARTING: 'device.state.starting',
    BOOTING: 'device.state.booting',
    IDLE: 'device.state.idle',
    CLEANING: 'device.state.cleaning',
    STOPPING: 'device.state.stopping',
    DEAD: 'device.state.dead',
};

function buildConnectedDeviceTitle(device: ConnectedAndroidDeviceInfo): string {
    return formatAndroidDeviceDisplayName(device);
}

function buildDeviceDetail(device: ConnectedAndroidDeviceInfo): string {
    const versionParts: string[] = [];
    if (device.androidVersion) {
        versionParts.push(`Android ${device.androidVersion}`);
    }
    if (device.apiLevel !== null) {
        versionParts.push(`API ${device.apiLevel}`);
    }

    const versionLabel = versionParts.join(', ');
    return versionLabel ? `${device.serial} • ${versionLabel}` : device.serial;
}

function getConnectedDeviceBadgeKey(
    connected: ConnectedAndroidDeviceInfo,
    runtime: AndroidDevicePoolStatusItem | undefined,
    projectId: string
): string {
    if (runtime) {
        if (runtime.state === 'ACQUIRED') {
            return isDeviceInUseByCurrentProject(runtime, projectId)
                ? 'device.inUseCurrentProject'
                : 'device.inUseOtherProject';
        }
        return DEVICE_STATE_LABEL_KEYS[runtime.state];
    }

    if (connected.adbState === 'device') return 'device.connected';
    if (connected.adbState === 'unauthorized') return 'device.adb.unauthorized';
    if (connected.adbState === 'offline') return 'device.adb.offline';
    return 'device.adb.unknown';
}

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
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    const fetchStatus = useCallback(async () => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/devices?projectId=${encodeURIComponent(projectId)}`, { headers });
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

    const handleStop = async (deviceId: string) => {
        setActionError(null);
        setStoppingDevices((current) => {
            const next = new Set(current);
            next.add(deviceId);
            return next;
        });
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
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            };
            const response = await fetch('/api/devices', {
                method: 'POST',
                headers,
                body: JSON.stringify({ action: 'stop', deviceId }),
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
                next.delete(deviceId);
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
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            };
            const response = await fetch('/api/devices', {
                method: 'POST',
                headers,
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

    const connectedRuntimeBySerial = new Map<string, AndroidDevicePoolStatusItem>();
    const runtimeByEmulatorProfile = new Map<string, AndroidDevicePoolStatusItem>();
    if (status) {
        for (const device of status.devices) {
            connectedRuntimeBySerial.set(device.serial, device);
            if (device.kind === 'emulator' && device.emulatorProfileName) {
                const normalizedProfileName = normalizeName(device.emulatorProfileName);
                const existing = runtimeByEmulatorProfile.get(normalizedProfileName);
                if (!existing || DEVICE_STATE_PRIORITY[device.state] < DEVICE_STATE_PRIORITY[existing.state]) {
                    runtimeByEmulatorProfile.set(normalizedProfileName, device);
                }
            }
        }
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-gray-900">{t('device.panel.title')}</h2>
                    {status && (
                        <span className="text-xs text-gray-400">
                            {status.devices.length} active
                            {status.waitingRequests > 0 && ` · ${t('device.waiting', { n: status.waitingRequests })}`}
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
                        {status.connectedDevices.length > 0 && (
                            <div className="px-4 py-2 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                                {t('device.section.connected')}
                            </div>
                        )}
                        {status.connectedDevices.map((connected) => {
                            const runtime = connectedRuntimeBySerial.get(connected.serial);
                            const badgeKey = getConnectedDeviceBadgeKey(connected, runtime, projectId);
                            const badgeColor = runtime
                                ? DEVICE_STATE_COLORS[runtime.state]
                                : connected.adbState === 'device'
                                    ? 'bg-green-100 text-green-700'
                                    : connected.adbState === 'unauthorized'
                                        ? 'bg-amber-100 text-amber-700'
                                        : 'bg-gray-100 text-gray-600';
                            return (
                                <div key={connected.serial} className="px-4 py-3">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium text-gray-900 truncate">
                                                {buildConnectedDeviceTitle(connected)}
                                            </div>
                                            <div className="text-xs text-gray-400 font-mono truncate">
                                                {buildDeviceDetail(connected)}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>
                                                {t(badgeKey)}
                                            </span>
                                            {runtime?.kind === 'emulator' && (
                                                <button
                                                    type="button"
                                                    onClick={() => void handleStop(runtime.id)}
                                                    disabled={
                                                        stoppingDevices.has(runtime.id)
                                                        || runtime.state === 'STOPPING'
                                                        || (runtime.state === 'ACQUIRED' && !isDeviceInUseByCurrentProject(runtime, projectId))
                                                    }
                                                    className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                                                >
                                                    {t('device.stop')}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {runtime?.state === 'ACQUIRED'
                                        && runtime.runTestCaseId
                                        && isDeviceInUseByCurrentProject(runtime, projectId) && (
                                        <div className="mt-1.5 ml-0.5">
                                            <Link
                                                href={`/test-cases/${runtime.runTestCaseId}/history/${runtime.runId}`}
                                                className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                            >
                                                → {runtime.runTestCaseDisplayId ?? t('device.testRun')} &ldquo;{runtime.runTestCaseName}&rdquo;
                                            </Link>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {status.emulatorProfiles.length > 0 && (
                            <div className="px-4 py-2 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                                {t('device.section.profiles')}
                            </div>
                        )}
                        {status.emulatorProfiles.map((profile) => {
                            const emulator = runtimeByEmulatorProfile.get(normalizeName(profile.name));
                            const isBootingThisProfile = !emulator && bootingProfiles.has(profile.name);
                            const displayState = emulator?.state ?? (isBootingThisProfile ? 'BOOTING' : null);
                            return (
                            <div key={profile.name} className="px-4 py-3">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium text-gray-900 truncate">{profile.displayName || profile.name}</div>
                                            <div className="text-xs text-gray-400 font-mono">
                                                {profile.apiLevel !== null ? `API ${profile.apiLevel}` : profile.name}
                                                {emulator ? ` • ${emulator.id}` : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${displayState ? DEVICE_STATE_COLORS[displayState] : 'bg-gray-100 text-gray-600'}`}>
                                            {displayState
                                                ? displayState === 'ACQUIRED'
                                                    ? t(emulator && isDeviceInUseByCurrentProject(emulator, projectId)
                                                        ? 'device.inUseCurrentProject'
                                                        : 'device.inUseOtherProject')
                                                    : t(DEVICE_STATE_LABEL_KEYS[displayState])
                                                : t('device.notRunning')}
                                        </span>
                                        {emulator && (
                                            <>
                                                {emulator.memoryUsageMb && (
                                                    <span className="text-xs text-gray-400">{emulator.memoryUsageMb}MB</span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => void handleStop(emulator.id)}
                                                    disabled={
                                                        stoppingDevices.has(emulator.id)
                                                        || emulator.state === 'STOPPING'
                                                        || (emulator.state === 'ACQUIRED' && !isDeviceInUseByCurrentProject(emulator, projectId))
                                                    }
                                                    className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                                                >
                                                    {t('device.stop')}
                                                </button>
                                            </>
                                        )}
                                        {!emulator && (
                                            <button
                                                type="button"
                                                onClick={() => void handleBoot(profile.name)}
                                                disabled={bootingProfiles.has(profile.name)}
                                                className="text-xs px-2 py-1 text-blue-700 border border-blue-200 rounded hover:bg-blue-50 disabled:opacity-50"
                                            >
                                                {t('device.bootWindow')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {emulator?.state === 'ACQUIRED'
                                    && emulator.runTestCaseId
                                    && isDeviceInUseByCurrentProject(emulator, projectId) && (
                                    <div className="mt-1.5 ml-0.5">
                                        <Link
                                            href={`/test-cases/${emulator.runTestCaseId}/history/${emulator.runId}`}
                                            className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                        >
                                            → {emulator.runTestCaseDisplayId ?? t('device.testRun')} &ldquo;{emulator.runTestCaseName}&rdquo;
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
