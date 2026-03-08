'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { Modal } from '@/components/shared';
import { useI18n } from '@/i18n';

interface TeamRunnersProps {
    teamId: string;
}

interface TeamRunnerItem {
    id: string;
    label: string;
    kind: string;
    status: string;
    protocolVersion: string;
    runnerVersion: string;
    lastSeenAt: string;
    isFresh: boolean;
    deviceCount: number;
    availableDeviceCount: number;
}

interface TeamRunnersResponse {
    teamId: string;
    runnerConnected: boolean;
    macRunnerOnlineCount: number;
    canManageRunners: boolean;
    refreshedAt: string;
    runners: TeamRunnerItem[];
}

interface TeamDeviceItem {
    id: string;
    runnerId: string;
    runnerLabel: string;
    deviceId: string;
    name: string;
    platform: string;
    state: string;
    metadata?: Record<string, unknown> | null;
    lastSeenAt: string;
    isFresh: boolean;
    isAvailable: boolean;
}

interface TeamDevicesResponse {
    teamId: string;
    runnerConnected: boolean;
    availableDeviceCount: number;
    staleDeviceCount: number;
    refreshedAt: string;
    devices: TeamDeviceItem[];
}

function isEmulatorProfileInventory(device: TeamDeviceItem): boolean {
    return device.metadata?.inventoryKind === 'emulator-profile';
}

interface PairingTokenResponse {
    token: string;
    expiresAt: string;
}

function resolveRunnerKindLabel(kind: string): string {
    if (kind === 'MACOS_AGENT') {
        return 'macOS';
    }
    return kind;
}

function buildRunnerStatusClass(runner: TeamRunnerItem): string {
    if (runner.status === 'ONLINE' && runner.isFresh) {
        return 'bg-green-100 text-green-700';
    }
    if (runner.status === 'ONLINE' && !runner.isFresh) {
        return 'bg-amber-100 text-amber-700';
    }
    return 'bg-gray-100 text-gray-700';
}

function buildRunnerStatusLabel(runner: TeamRunnerItem, t: (key: string) => string): string {
    if (runner.status === 'ONLINE' && runner.isFresh) {
        return t('device.state.online');
    }
    if (runner.status === 'ONLINE' && !runner.isFresh) {
        return t('device.state.stale');
    }
    return t('device.state.offline');
}

function buildDeviceStatusClass(device: TeamDeviceItem): string {
    if (device.isAvailable) {
        return 'bg-green-100 text-green-700';
    }
    if (device.state === 'OFFLINE' && isEmulatorProfileInventory(device)) {
        return 'bg-gray-100 text-gray-700';
    }
    if (device.state === 'ONLINE' && !device.isFresh) {
        return 'bg-amber-100 text-amber-700';
    }
    if (device.state === 'UNAVAILABLE') {
        return 'bg-red-100 text-red-700';
    }
    return 'bg-gray-100 text-gray-700';
}

function buildDeviceStatusLabel(device: TeamDeviceItem, t: (key: string) => string): string {
    if (device.isAvailable) {
        return t('device.state.online');
    }
    if (device.state === 'OFFLINE' && isEmulatorProfileInventory(device)) {
        return t('device.state.notRunning');
    }
    if (device.state === 'ONLINE' && !device.isFresh) {
        return t('device.state.stale');
    }
    if (device.state === 'UNAVAILABLE') {
        return t('device.state.unavailable');
    }
    return t('device.state.offline');
}

export default function TeamRunners({ teamId }: TeamRunnersProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [isLoading, setIsLoading] = useState(true);
    const [runners, setRunners] = useState<TeamRunnersResponse | null>(null);
    const [devices, setDevices] = useState<TeamDevicesResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPairingModalOpen, setIsPairingModalOpen] = useState(false);
    const [pairingToken, setPairingToken] = useState<string | null>(null);
    const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
    const [isGeneratingToken, setIsGeneratingToken] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [unpairCandidate, setUnpairCandidate] = useState<TeamRunnerItem | null>(null);
    const [pendingUnpairRunnerId, setPendingUnpairRunnerId] = useState<string | null>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    const fetchData = useCallback(async () => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
            return;
        }

        const token = await getAccessToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

        const [runnersRes, devicesRes] = await Promise.all([
            fetch(`/api/teams/${encodeURIComponent(teamId)}/runners`, { headers }),
            fetch(`/api/teams/${encodeURIComponent(teamId)}/devices`, { headers }),
        ]);

        if (!runnersRes.ok || !devicesRes.ok) {
            throw new Error('Failed to load team runners');
        }

        const [runnersPayload, devicesPayload] = await Promise.all([
            runnersRes.json() as Promise<TeamRunnersResponse>,
            devicesRes.json() as Promise<TeamDevicesResponse>,
        ]);

        setRunners(runnersPayload);
        setDevices(devicesPayload);
    }, [getAccessToken, teamId]);

    useEffect(() => {
        let mounted = true;

        const runInitialLoad = async () => {
            try {
                setIsLoading(true);
                await fetchData();
                if (mounted) {
                    setError(null);
                }
            } catch {
                if (mounted) {
                    setError(t('team.runners.error.load'));
                }
            } finally {
                if (mounted) {
                    setIsLoading(false);
                }
            }
        };

        const startPolling = () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
            }
            pollRef.current = setInterval(() => {
                void fetchData().catch(() => {
                    setError(t('team.runners.error.load'));
                });
            }, 15_000);
        };

        const stopPolling = () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void fetchData().catch(() => {
                    setError(t('team.runners.error.load'));
                });
                startPolling();
            } else {
                stopPolling();
            }
        };

        void runInitialLoad();
        startPolling();
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            mounted = false;
            stopPolling();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [fetchData, t]);

    const createPairingToken = useCallback(async () => {
        setError(null);
        setIsGeneratingToken(true);

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/runner-pairing`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ ttlMinutes: 10 }),
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({ error: t('team.runners.error.pairing') }));
                throw new Error(payload.error || t('team.runners.error.pairing'));
            }

            const payload = await response.json() as PairingTokenResponse;
            setPairingToken(payload.token);
            setPairingExpiresAt(payload.expiresAt);
            setIsPairingModalOpen(true);
        } catch (generationError) {
            const message = generationError instanceof Error
                ? generationError.message
                : t('team.runners.error.pairing');
            setError(message);
        } finally {
            setIsGeneratingToken(false);
        }
    }, [getAccessToken, teamId, t]);

    const copyPairingToken = useCallback(async () => {
        if (!pairingToken || isCopying) {
            return;
        }
        setIsCopying(true);
        try {
            await navigator.clipboard.writeText(pairingToken);
        } finally {
            setTimeout(() => setIsCopying(false), 1200);
        }
    }, [pairingToken, isCopying]);

    const closeUnpairModal = useCallback(() => {
        if (pendingUnpairRunnerId) {
            return;
        }
        setUnpairCandidate(null);
    }, [pendingUnpairRunnerId]);

    const unpairRunner = useCallback(async () => {
        if (!unpairCandidate || pendingUnpairRunnerId) {
            return;
        }

        const runnerId = unpairCandidate.id;

        setError(null);
        setPendingUnpairRunnerId(runnerId);
        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/runners/${encodeURIComponent(runnerId)}`, {
                method: 'DELETE',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({ error: t('team.runners.error.unpair') }));
                throw new Error(payload.error || t('team.runners.error.unpair'));
            }

            await fetchData();
            setUnpairCandidate(null);
        } catch (unpairError) {
            const message = unpairError instanceof Error
                ? unpairError.message
                : t('team.runners.error.unpair');
            setError(message);
        } finally {
            setPendingUnpairRunnerId(null);
        }
    }, [fetchData, getAccessToken, pendingUnpairRunnerId, teamId, t, unpairCandidate]);

    return (
        <div className="space-y-6">
            <Modal
                isOpen={isPairingModalOpen}
                onClose={() => setIsPairingModalOpen(false)}
                title={t('team.runners.pairing.title')}
                showFooter={false}
                panelClassName="max-w-xl"
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">{t('team.runners.pairing.subtitle')}</p>
                    <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
                        <p className="text-xs font-medium text-gray-500">{t('team.runners.pairing.token')}</p>
                        <div className="mt-2 break-all font-mono text-sm text-gray-900">{pairingToken}</div>
                    </div>
                    <p className="text-xs text-gray-500">
                        {pairingExpiresAt
                            ? t('team.runners.pairing.expiresAt', { time: new Date(pairingExpiresAt).toLocaleString() })
                            : ''}
                    </p>
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => void copyPairingToken()}
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            {isCopying ? t('common.copied') : t('common.copy')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsPairingModalOpen(false)}
                            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
                        >
                            {t('common.confirm')}
                        </button>
                    </div>
                </div>
            </Modal>
            <Modal
                isOpen={Boolean(unpairCandidate)}
                onClose={closeUnpairModal}
                title={t('team.runners.unpair.dialog.title')}
                onConfirm={() => void unpairRunner()}
                confirmText={pendingUnpairRunnerId ? t('team.runners.unpair.loading') : t('team.runners.unpair')}
                confirmVariant="danger"
                closeOnConfirm={false}
                confirmDisabled={pendingUnpairRunnerId !== null || !unpairCandidate}
            >
                <div className="space-y-3 text-sm">
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                        {t('team.runners.unpair.dialog.warning')}
                    </p>
                    <p className="text-gray-600">
                        {t('team.runners.unpair.dialog.target', { label: unpairCandidate?.label ?? '-' })}
                    </p>
                </div>
            </Modal>

            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">{t('team.runners.title')}</h2>
                        <p className="mt-1 text-sm text-gray-500">{t('team.runners.subtitle')}</p>
                    </div>
                    {runners?.canManageRunners && (
                        <button
                            type="button"
                            onClick={() => void createPairingToken()}
                            disabled={isGeneratingToken}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                        >
                            {isGeneratingToken ? t('team.runners.add.loading') : t('team.runners.add')}
                        </button>
                    )}
                </div>

                {error && (
                    <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {error}
                    </div>
                )}

                {isLoading || !runners || !devices ? (
                    <div className="mt-4 flex items-center gap-3 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-600">
                        <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary"></div>
                        <span>{t('common.loading')}</span>
                    </div>
                ) : (
                    <div className="mt-4 space-y-6">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-900">{t('team.runners.table.title')}</h3>
                            {runners.runners.length === 0 ? (
                                <p className="mt-3 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-500">
                                    {t('team.runners.table.empty')}
                                </p>
                            ) : (
                                <div className="mt-3 overflow-x-auto rounded-md border border-gray-200">
                                    <table className="min-w-full text-sm">
                                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                                            <tr>
                                                <th className="px-4 py-3 text-left">{t('team.runners.table.runner')}</th>
                                                <th className="px-4 py-3 text-left">{t('team.runners.table.kind')}</th>
                                                <th className="px-4 py-3 text-left">{t('team.runners.table.status')}</th>
                                                <th className="px-4 py-3 text-left">{t('team.runners.table.devices')}</th>
                                                <th className="px-4 py-3 text-left">{t('team.runners.table.lastSeen')}</th>
                                                {runners.canManageRunners && (
                                                    <th className="px-4 py-3 text-left">{t('team.runners.table.actions')}</th>
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 text-gray-700">
                                            {runners.runners.map((runner) => (
                                                <tr key={runner.id}>
                                                    <td className="px-4 py-3">
                                                        <p className="font-medium text-gray-900">{runner.label}</p>
                                                        <p className="text-xs text-gray-500">{runner.runnerVersion}</p>
                                                    </td>
                                                    <td className="px-4 py-3">{resolveRunnerKindLabel(runner.kind)}</td>
                                                    <td className="px-4 py-3">
                                                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${buildRunnerStatusClass(runner)}`}>
                                                            {buildRunnerStatusLabel(runner, t)}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">{runner.availableDeviceCount} / {runner.deviceCount}</td>
                                                    <td className="px-4 py-3">{new Date(runner.lastSeenAt).toLocaleString()}</td>
                                                    {runners.canManageRunners && (
                                                        <td className="px-4 py-3">
                                                            {runner.status === 'ONLINE' && runner.isFresh ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setError(null);
                                                                        setUnpairCandidate(runner);
                                                                    }}
                                                                    disabled={pendingUnpairRunnerId !== null}
                                                                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                                                                >
                                                                    {pendingUnpairRunnerId === runner.id
                                                                        ? t('team.runners.unpair.loading')
                                                                        : t('team.runners.unpair')}
                                                                </button>
                                                            ) : (
                                                                <span className="text-xs text-gray-400">-</span>
                                                            )}
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div>
                            <h3 className="text-sm font-semibold text-gray-900">{t('team.runners.devices.title')}</h3>
                            {devices.devices.length === 0 ? (
                                <p className="mt-3 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-500">
                                    {t('team.runners.devices.empty')}
                                </p>
                            ) : (
                                <div className="mt-3 overflow-x-auto rounded-md border border-gray-200">
                                    <table className="min-w-full text-sm">
                                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                                            <tr>
                                                <th className="px-4 py-3 text-left">{t('team.runners.devices.name')}</th>
                                                <th className="px-4 py-3 text-left">{t('team.runners.devices.id')}</th>
                                                <th className="px-4 py-3 text-left">{t('team.runners.devices.runner')}</th>
                                                <th className="px-4 py-3 text-left">{t('team.runners.devices.status')}</th>
                                                <th className="px-4 py-3 text-left">{t('team.runners.devices.lastSeen')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 text-gray-700">
                                            {devices.devices.map((device) => (
                                                <tr key={device.id}>
                                                    <td className="px-4 py-3">
                                                        <p className="font-medium text-gray-900">{device.name}</p>
                                                        <p className="text-xs text-gray-500">{device.platform}</p>
                                                    </td>
                                                    <td className="px-4 py-3">{device.deviceId}</td>
                                                    <td className="px-4 py-3">{device.runnerLabel}</td>
                                                    <td className="px-4 py-3">
                                                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${buildDeviceStatusClass(device)}`}>
                                                            {buildDeviceStatusLabel(device, t)}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">{new Date(device.lastSeenAt).toLocaleString()}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
