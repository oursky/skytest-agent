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
    displayId: string;
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
    return 'bg-gray-100 text-gray-700';
}

function buildRunnerStatusLabel(runner: TeamRunnerItem, t: (key: string) => string): string {
    if (runner.status === 'ONLINE' && runner.isFresh) {
        return t('device.state.online');
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
        return 'bg-gray-100 text-gray-700';
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
        return t('device.state.offline');
    }
    if (device.state === 'UNAVAILABLE') {
        return t('device.state.unavailable');
    }
    return t('device.state.offline');
}

function resolveRunnerDisplayId(runner: Pick<TeamRunnerItem, 'id' | 'displayId'>): string {
    return runner.displayId;
}

function buildPairCommand(token: string | null): string {
    const tokenPart = token ?? '<pairing-token>';
    const serverUrl = typeof window !== 'undefined' ? window.location.origin : '<server-url>';
    return `skytest pair runner "${tokenPart}" --url "${serverUrl}"`;
}

function buildStartRunnerCommand(runnerDisplayId: string): string {
    const escaped = runnerDisplayId.replace(/'/g, '\'\\\'\'');
    return `skytest start runner '${escaped}'`;
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
    const [isCopyingPairCommand, setIsCopyingPairCommand] = useState(false);
    const [copiedCommandKey, setCopiedCommandKey] = useState<string | null>(null);
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

    const offlineRunners = runners?.runners.filter((runner) => (
        runner.status !== 'ONLINE' || !runner.isFresh
    )) ?? [];

    const copyCommand = useCallback(async (key: string, text: string) => {
        await navigator.clipboard.writeText(text);
        setCopiedCommandKey(key);
        setTimeout(() => setCopiedCommandKey((current) => (current === key ? null : current)), 1200);
    }, []);

    const copyPairCommand = useCallback(async () => {
        if (isCopyingPairCommand) {
            return;
        }
        setIsCopyingPairCommand(true);
        try {
            await navigator.clipboard.writeText(buildPairCommand(pairingToken));
        } finally {
            setTimeout(() => setIsCopyingPairCommand(false), 1200);
        }
    }, [pairingToken, isCopyingPairCommand]);

    return (
        <div className="space-y-6">
            <Modal
                isOpen={isPairingModalOpen}
                onClose={() => {
                    setIsPairingModalOpen(false);
                    setPairingToken(null);
                    setPairingExpiresAt(null);
                }}
                title={t('team.runners.pairing.title')}
                showFooter={false}
                panelClassName="max-w-xl"
            >
                <div className="space-y-5">
                    <div>
                        <p className="text-sm font-medium text-gray-900">{t('team.runners.pairing.token')}</p>
                        {pairingToken ? (
                            <div className="mt-2 space-y-2">
                                <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                                    <p className="break-all font-mono text-sm text-gray-900">{pairingToken}</p>
                                </div>
                                <div className="flex items-center justify-between">
                                    <p className="text-xs text-gray-500">
                                        {pairingExpiresAt
                                            ? t('team.runners.pairing.expiresAt', { time: new Date(pairingExpiresAt).toLocaleString() })
                                            : ''}
                                    </p>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void copyPairingToken()}
                                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                        >
                                            {isCopying ? t('common.copied') : t('common.copy')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void createPairingToken()}
                                            disabled={isGeneratingToken}
                                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                        >
                                            {isGeneratingToken ? t('team.runners.add.loading') : t('team.runners.pairing.regenerate')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-2 space-y-3">
                                <p className="text-sm text-gray-500">{t('team.runners.pairing.step1.description')}</p>
                                <button
                                    type="button"
                                    onClick={() => void createPairingToken()}
                                    disabled={isGeneratingToken}
                                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                                >
                                    {isGeneratingToken ? t('team.runners.add.loading') : t('team.runners.pairing.generate')}
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-gray-100" />

                    <div>
                        <p className="text-sm font-medium text-gray-900">{t('team.runners.pairing.pairTitle')}</p>
                        <p className="mt-1 text-sm text-gray-500">{t('team.runners.pairing.pairDescription')}</p>
                        <div className="mt-3">
                            <p className="text-xs font-medium text-gray-500 mb-1.5">{t('team.runners.pairing.commandLabel')}</p>
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => void copyPairCommand()}
                                    aria-label={isCopyingPairCommand ? t('common.copied') : t('common.copy')}
                                    title={isCopyingPairCommand ? t('common.copied') : t('common.copy')}
                                    className="absolute top-2 right-2 z-10 h-7 w-7 flex items-center justify-center text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-100"
                                >
                                    {isCopyingPairCommand ? (
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    ) : (
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                            <rect x="9" y="9" width="10" height="10" rx="2" strokeWidth="2" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 15H6a2 2 0 01-2-2V6a2 2 0 012-2h7a2 2 0 012 2v1" />
                                        </svg>
                                    )}
                                </button>
                                <pre className="bg-gray-50 text-gray-800 text-xs rounded border border-gray-200 p-3 pr-10 overflow-x-auto">
                                    <code>{buildPairCommand(pairingToken)}</code>
                                </pre>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end border-t border-gray-100 pt-4">
                        <button
                            type="button"
                            onClick={() => {
                                setIsPairingModalOpen(false);
                                setPairingToken(null);
                                setPairingExpiresAt(null);
                            }}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                        >
                            {t('common.done')}
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
                            onClick={() => setIsPairingModalOpen(true)}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                        >
                            {t('team.runners.add')}
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
                                            {runners.runners.map((runner) => {
                                                return (
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
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setError(null);
                                                                        setUnpairCandidate(runner);
                                                                    }}
                                                                    disabled={pendingUnpairRunnerId !== null}
                                                                    className="text-sm font-medium text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:text-red-300"
                                                                >
                                                                    {pendingUnpairRunnerId === runner.id
                                                                        ? t('team.runners.unpair.loading')
                                                                        : t('team.runners.unpair')}
                                                                </button>
                                                            </td>
                                                        )}
                                                    </tr>
                                                );
                                            })}
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

            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900">{t('team.runners.troubleshooting.title')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('team.runners.troubleshooting.subtitle')}</p>

                <div className="mt-4 space-y-4">
                    {[
                        { key: 'get-runners', label: t('team.runners.troubleshooting.listRunners'), command: 'skytest get runners' },
                        { key: 'pair-runner', label: t('team.runners.troubleshooting.pairRunner'), command: buildPairCommand(null) },
                        { key: 'start-runner', label: t('team.runners.troubleshooting.start'), command: "skytest start runner '<runner-id>'" },
                        { key: 'stop-runner', label: t('team.runners.troubleshooting.stop'), command: "skytest stop runner '<runner-id>'" },
                        { key: 'logs-runner', label: t('team.runners.troubleshooting.logs'), command: "skytest logs runner '<runner-id>' --tail 200" },
                        { key: 'unpair-runner', label: t('team.runners.troubleshooting.unpairRunner'), command: "skytest unpair runner '<runner-id>'" },
                    ].map(({ key, label, command }) => (
                        <div key={key}>
                            <p className="text-xs font-medium text-gray-700 mb-1.5">{label}</p>
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => void copyCommand(key, command)}
                                    aria-label={copiedCommandKey === key ? t('common.copied') : t('common.copy')}
                                    title={copiedCommandKey === key ? t('common.copied') : t('common.copy')}
                                    className="absolute top-2 right-2 z-10 h-7 w-7 flex items-center justify-center text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-100"
                                >
                                    {copiedCommandKey === key ? (
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    ) : (
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                            <rect x="9" y="9" width="10" height="10" rx="2" strokeWidth="2" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 15H6a2 2 0 01-2-2V6a2 2 0 012-2h7a2 2 0 012 2v1" />
                                        </svg>
                                    )}
                                </button>
                                <pre className="bg-gray-50 text-gray-800 text-xs rounded border border-gray-200 p-3 pr-10 overflow-x-auto">
                                    <code>{command}</code>
                                </pre>
                            </div>
                        </div>
                    ))}
                </div>

                {!isLoading && runners && offlineRunners.length > 0 && (
                    <div className="mt-6 space-y-3">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('team.runners.troubleshooting.offlineTitle')}</p>
                        {offlineRunners.map((runner) => {
                            const runnerDisplayId = resolveRunnerDisplayId(runner);
                            const startCommand = buildStartRunnerCommand(runnerDisplayId);
                            const commandKey = `${runner.id}-start`;
                            return (
                                <div key={runner.id} className="rounded-md border border-amber-200 bg-amber-50 p-4">
                                    <div className="mb-3">
                                        <p className="text-sm font-medium text-gray-900">{runner.label}</p>
                                        <p className="text-xs text-gray-500">
                                            {t('team.runners.troubleshooting.runnerId', { id: runnerDisplayId })}
                                        </p>
                                    </div>
                                    <p className="text-xs font-medium text-gray-700 mb-1.5">{t('team.runners.troubleshooting.start')}</p>
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => void copyCommand(commandKey, startCommand)}
                                            aria-label={copiedCommandKey === commandKey ? t('common.copied') : t('common.copy')}
                                            title={copiedCommandKey === commandKey ? t('common.copied') : t('common.copy')}
                                            className="absolute top-2 right-2 z-10 h-7 w-7 flex items-center justify-center text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-100"
                                        >
                                            {copiedCommandKey === commandKey ? (
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            ) : (
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                                    <rect x="9" y="9" width="10" height="10" rx="2" strokeWidth="2" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 15H6a2 2 0 01-2-2V6a2 2 0 012-2h7a2 2 0 012 2v1" />
                                                </svg>
                                            )}
                                        </button>
                                        <pre className="bg-gray-50 text-gray-800 text-xs rounded border border-gray-200 p-3 pr-10 overflow-x-auto">
                                            <code>{startCommand}</code>
                                        </pre>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}
