'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { AndroidDevicePoolStatus, AndroidDevicePoolStatusItem } from '@/lib/android-device-manager';
import type { ConnectedAndroidDeviceInfo } from '@/lib/android-device-display';
import { formatAndroidDeviceDisplayName } from '@/lib/android-device-display';
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

const ADB_STATE_PRIORITY: Record<ConnectedAndroidDeviceInfo['adbState'], number> = {
    device: 0,
    unauthorized: 1,
    offline: 2,
    unknown: 3,
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

function joinDeviceDetail(parts: Array<string | null | undefined>): string {
    return parts.filter((part): part is string => Boolean(part && part.trim())).join(', ');
}

function buildVersionDetail(androidVersion: string | null, apiLevel: number | null): string {
    return joinDeviceDetail([
        androidVersion ? `Android ${androidVersion}` : null,
        apiLevel !== null ? `API ${apiLevel}` : null,
    ]);
}

function buildConnectedDeviceDetail(device: ConnectedAndroidDeviceInfo): string {
    return joinDeviceDetail([
        device.serial,
        buildVersionDetail(device.androidVersion, device.apiLevel),
    ]) || device.serial;
}

function getInventoryOnlyBadgeKey(connected: ConnectedAndroidDeviceInfo): string {
    if (connected.adbState === 'device') return 'device.state.idle';
    if (connected.adbState === 'unauthorized') return 'device.adb.unauthorized';
    if (connected.adbState === 'offline') return 'device.adb.offline';
    return 'device.adb.unknown';
}

function getInventoryOnlyBadgeColor(connected: ConnectedAndroidDeviceInfo): string {
    if (connected.adbState === 'device') return DEVICE_STATE_COLORS.IDLE;
    if (connected.adbState === 'unauthorized') return 'bg-amber-100 text-amber-700';
    return 'bg-gray-100 text-gray-600';
}

function getDeviceBadgeKey(
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

    return getInventoryOnlyBadgeKey(connected);
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
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            };
            const response = await fetch('/api/devices', {
                method: 'POST',
                headers,
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
    const connectedPhysicalDevices: ConnectedAndroidDeviceInfo[] = [];
    const connectedEmulatorsBySerial = new Map<string, ConnectedAndroidDeviceInfo>();
    const connectedEmulatorsByProfile = new Map<string, ConnectedAndroidDeviceInfo>();
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

        for (const connected of status.connectedDevices) {
            if (connected.kind === 'physical') {
                connectedPhysicalDevices.push(connected);
                continue;
            }

            connectedEmulatorsBySerial.set(connected.serial, connected);
            if (!connected.emulatorProfileName) {
                continue;
            }

            const normalizedProfileName = normalizeName(connected.emulatorProfileName);
            const existing = connectedEmulatorsByProfile.get(normalizedProfileName);
            if (!existing || ADB_STATE_PRIORITY[connected.adbState] < ADB_STATE_PRIORITY[existing.adbState]) {
                connectedEmulatorsByProfile.set(normalizedProfileName, connected);
            }
        }
    }

    const emulatorRows: Array<{
        key: string;
        title: string;
        detail: string;
        runtime?: AndroidDevicePoolStatusItem;
        connected?: ConnectedAndroidDeviceInfo;
        profileName?: string;
        canBoot: boolean;
    }> = [];

    if (status) {
        const usedConnectedEmulatorSerials = new Set<string>();
        const usedRuntimeIds = new Set<string>();

        for (const profile of status.emulatorProfiles) {
            const runtime = runtimeByEmulatorProfile.get(normalizeName(profile.name));
            if (runtime) {
                usedRuntimeIds.add(runtime.id);
            }

            const connected = runtime
                ? connectedEmulatorsBySerial.get(runtime.serial)
                : connectedEmulatorsByProfile.get(normalizeName(profile.name));
            if (connected) {
                usedConnectedEmulatorSerials.add(connected.serial);
            }

            const detail = joinDeviceDetail([
                connected?.serial ?? runtime?.serial,
                buildVersionDetail(connected?.androidVersion ?? null, connected?.apiLevel ?? profile.apiLevel),
            ]) || profile.name;

            emulatorRows.push({
                key: `profile:${profile.name}`,
                title: profile.displayName || profile.name,
                detail,
                runtime,
                connected,
                profileName: profile.name,
                canBoot: !runtime && !connected,
            });
        }

        for (const connected of status.connectedDevices) {
            if (connected.kind !== 'emulator' || usedConnectedEmulatorSerials.has(connected.serial)) {
                continue;
            }

            const runtime = connectedRuntimeBySerial.get(connected.serial);
            if (runtime) {
                usedRuntimeIds.add(runtime.id);
            }

            emulatorRows.push({
                key: `connected-emulator:${connected.serial}`,
                title: buildConnectedDeviceTitle(connected),
                detail: buildConnectedDeviceDetail(connected),
                runtime,
                connected,
                canBoot: false,
            });
        }

        for (const runtime of status.devices) {
            if (runtime.kind !== 'emulator' || usedRuntimeIds.has(runtime.id)) {
                continue;
            }

            emulatorRows.push({
                key: `runtime-emulator:${runtime.id}`,
                title: runtime.emulatorProfileName ?? runtime.id,
                detail: runtime.serial,
                runtime,
                canBoot: false,
            });
        }
    }

    const showPhysicalSection = connectedPhysicalDevices.length > 0;
    const showEmulatorSection = Boolean(status && emulatorRows.length > 0);

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
                        {connectedPhysicalDevices.map((connected) => {
                            const runtime = connectedRuntimeBySerial.get(connected.serial);
                            const badgeKey = getDeviceBadgeKey(connected, runtime, projectId);
                            const badgeColor = runtime
                                ? DEVICE_STATE_COLORS[runtime.state]
                                : getInventoryOnlyBadgeColor(connected);
                            return (
                                <div key={connected.serial} className="px-4 py-3">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium text-gray-900 truncate">
                                                {buildConnectedDeviceTitle(connected)}
                                            </div>
                                            <div className="text-xs text-gray-400 font-mono truncate">
                                                {buildConnectedDeviceDetail(connected)}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>
                                                {t(badgeKey)}
                                            </span>
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
                        {showEmulatorSection && (
                            <div className="px-4 py-2 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                                {t('device.section.profiles')}
                            </div>
                        )}
                        {emulatorRows.map((row) => {
                            const emulator = row.runtime;
                            const connected = row.connected;
                            const bootProfileName = row.profileName;
                            const showBootingAction = emulator?.state === 'BOOTING' && Boolean(bootProfileName);
                            const isBootingThisProfile = !emulator && Boolean(row.profileName && bootingProfiles.has(row.profileName));
                            const isStoppingConnectedEmulator = !emulator && Boolean(connected && stoppingDevices.has(connected.serial));
                            const badgeKey = emulator
                                ? emulator.state === 'ACQUIRED'
                                    ? (isDeviceInUseByCurrentProject(emulator, projectId)
                                        ? 'device.inUseCurrentProject'
                                        : 'device.inUseOtherProject')
                                    : DEVICE_STATE_LABEL_KEYS[emulator.state]
                                : isStoppingConnectedEmulator
                                    ? 'device.state.stopping'
                                : connected
                                    ? (isBootingThisProfile ? 'device.state.booting' : getInventoryOnlyBadgeKey(connected))
                                    : isBootingThisProfile
                                        ? 'device.state.booting'
                                        : 'device.notRunning';
                            const badgeColor = emulator
                                ? DEVICE_STATE_COLORS[emulator.state]
                                : isStoppingConnectedEmulator
                                    ? DEVICE_STATE_COLORS.STOPPING
                                : connected
                                    ? getInventoryOnlyBadgeColor(connected)
                                    : isBootingThisProfile
                                        ? DEVICE_STATE_COLORS.BOOTING
                                        : 'bg-gray-100 text-gray-600';
                            return (
                            <div key={row.key} className="px-4 py-3">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium text-gray-900 truncate">{row.title}</div>
                                            <div className="text-xs text-gray-400 font-mono truncate">{row.detail}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>
                                            {t(badgeKey)}
                                        </span>
                                        {emulator && (
                                            <>
                                                {emulator.memoryUsageMb && (
                                                    <span className="text-xs text-gray-400">{emulator.memoryUsageMb}MB</span>
                                                )}
                                                {showBootingAction ? (
                                                    <button
                                                        type="button"
                                                        disabled
                                                        className="text-xs px-2 py-1 text-blue-700 border border-blue-200 rounded disabled:opacity-50"
                                                    >
                                                        {t('device.bootWindow')}
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleStop({ deviceId: emulator.id })}
                                                        disabled={
                                                            stoppingDevices.has(emulator.id)
                                                            || emulator.state === 'STOPPING'
                                                            || (emulator.state === 'ACQUIRED' && !isDeviceInUseByCurrentProject(emulator, projectId))
                                                        }
                                                        className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                                                    >
                                                        {t('device.stop')}
                                                    </button>
                                                )}
                                            </>
                                        )}
                                        {!emulator && row.canBoot && bootProfileName && (
                                            <button
                                                type="button"
                                                onClick={() => void handleBoot(bootProfileName)}
                                                disabled={bootingProfiles.has(bootProfileName)}
                                                className="text-xs px-2 py-1 text-blue-700 border border-blue-200 rounded hover:bg-blue-50 disabled:opacity-50"
                                            >
                                                {t('device.bootWindow')}
                                            </button>
                                        )}
                                        {!emulator && connected?.adbState === 'device' && (
                                            <button
                                                type="button"
                                                onClick={() => void handleStop({ serial: connected.serial })}
                                                disabled={stoppingDevices.has(connected.serial)}
                                                className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                                            >
                                                {t('device.stop')}
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
