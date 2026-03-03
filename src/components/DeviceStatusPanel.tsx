'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { AndroidDevicePoolStatusItem } from '@/lib/android/device-manager';
import type { ConnectedAndroidDeviceInfo } from '@/lib/android/device-display';
import { formatAndroidDeviceDisplayName } from '@/lib/android/device-display';
import { DEVICE_STATE_COLORS } from '@/utils/deviceStateColors';
import { buildAuthHeaders } from './config-shared/config-utils';
import type { DeviceStatusResponse } from './device-status/types';
import { buildDeviceSections } from './device-status/build-device-sections';
import DeviceRunLink from './device-status/DeviceRunLink';
import {
    buildAndroidVersionDetail,
    getInventoryOnlyStatusColorClass,
    getInventoryOnlyStatusKey,
    joinAndroidDeviceDetail,
} from './configurations-section/device-utils';

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

function formatCountdown(remainingMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function buildConnectedDeviceDetail(device: ConnectedAndroidDeviceInfo): string {
    return joinAndroidDeviceDetail([
        device.serial,
        buildAndroidVersionDetail(device.androidVersion, device.apiLevel),
    ]) || device.serial;
}

function getInventoryOnlyBadgeKey(connected: ConnectedAndroidDeviceInfo): string {
    return getInventoryOnlyStatusKey(connected);
}

function getInventoryOnlyBadgeColor(connected: ConnectedAndroidDeviceInfo): string {
    return getInventoryOnlyStatusColorClass(connected);
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
                                        <DeviceRunLink
                                            runTestCaseId={runtime.runTestCaseId}
                                            runId={runtime.runId}
                                            runTestCaseDisplayId={runtime.runTestCaseDisplayId}
                                            runTestCaseName={runtime.runTestCaseName}
                                            fallbackLabel={t('device.testRun')}
                                        />
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
                            const idleCountdown = emulator?.state === 'IDLE' && typeof emulator.idleDeadlineAt === 'number'
                                ? formatCountdown(emulator.idleDeadlineAt - nowMs)
                                : null;
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
                                        {idleCountdown && (
                                            <span className="text-xs text-gray-500 font-mono">{idleCountdown}</span>
                                        )}
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
                                    <DeviceRunLink
                                        runTestCaseId={emulator.runTestCaseId}
                                        runId={emulator.runId}
                                        runTestCaseDisplayId={emulator.runTestCaseDisplayId}
                                        runTestCaseName={emulator.runTestCaseName}
                                        fallbackLabel={t('device.testRun')}
                                    />
                                )}
                            </div>
                        )})}
                    </div>
                )}
            </div>
        </div>
    );
}
