'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { Button, CopyableCodeBlock, LoadingSpinner, Modal } from '@/components/shared';
import { useI18n } from '@/i18n';
import type {
    TeamDeviceItem,
    TeamDevicesResponse,
    TeamRunnerItem,
    TeamRunnersResponse,
} from '../model/types';
import RunnerInventoryTables from './RunnerInventoryTables';
import RunnerTroubleshootingSection from './RunnerTroubleshootingSection';

interface TeamRunnersProps {
    teamId: string;
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
    if (device.activeRunId) {
        return 'bg-amber-100 text-amber-700';
    }
    if (device.inUseByAnotherTeam) {
        return 'bg-red-100 text-red-700';
    }
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
    if (device.activeRunId) {
        return t('device.inUseOtherProject');
    }
    if (device.inUseByAnotherTeam) {
        return t('device.inUseAnotherTeam');
    }
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

    const copyLabel = t('common.copy');
    const copiedLabel = t('common.copied');

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
                                        <Button
                                            onClick={() => void copyPairingToken()}
                                            variant="secondary"
                                            size="xs"
                                        >
                                            {isCopying ? t('common.copied') : t('common.copy')}
                                        </Button>
                                        <Button
                                            onClick={() => void createPairingToken()}
                                            disabled={isGeneratingToken}
                                            variant="secondary"
                                            size="xs"
                                        >
                                            {isGeneratingToken ? t('team.runners.add.loading') : t('team.runners.pairing.regenerate')}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-2 space-y-3">
                                <p className="text-sm text-gray-500">{t('team.runners.pairing.step1.description')}</p>
                                <Button
                                    onClick={() => void createPairingToken()}
                                    disabled={isGeneratingToken}
                                    variant="primary"
                                    size="sm"
                                >
                                    {isGeneratingToken ? t('team.runners.add.loading') : t('team.runners.pairing.generate')}
                                </Button>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-gray-100" />

                    <div>
                        <p className="text-sm font-medium text-gray-900">{t('team.runners.pairing.pairTitle')}</p>
                        <p className="mt-1 text-sm text-gray-500">{t('team.runners.pairing.pairDescription')}</p>
                        <div className="mt-3">
                            <p className="text-xs font-medium text-gray-500 mb-1.5">{t('team.runners.pairing.commandLabel')}</p>
                            <CopyableCodeBlock
                                code={buildPairCommand(pairingToken)}
                                copied={isCopyingPairCommand}
                                onCopy={() => void copyPairCommand()}
                                copyLabel={copyLabel}
                                copiedLabel={copiedLabel}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end border-t border-gray-100 pt-4">
                        <Button
                            onClick={() => {
                                setIsPairingModalOpen(false);
                                setPairingToken(null);
                                setPairingExpiresAt(null);
                            }}
                            variant="primary"
                            size="sm"
                        >
                            {t('common.done')}
                        </Button>
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
                        <Button
                            onClick={() => setIsPairingModalOpen(true)}
                            variant="primary"
                            size="sm"
                        >
                            {t('team.runners.add')}
                        </Button>
                    )}
                </div>

                {error && (
                    <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {error}
                    </div>
                )}

                {isLoading || !runners || !devices ? (
                    <div className="mt-4 flex items-center gap-3 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-600">
                        <LoadingSpinner size={16} />
                        <span>{t('common.loading')}</span>
                    </div>
                ) : (
                    <RunnerInventoryTables
                        runners={runners}
                        devices={devices}
                        pendingUnpairRunnerId={pendingUnpairRunnerId}
                        onRequestUnpair={(runner) => {
                            setError(null);
                            setUnpairCandidate(runner);
                        }}
                        resolveRunnerKindLabel={resolveRunnerKindLabel}
                        buildRunnerStatusClass={buildRunnerStatusClass}
                        buildRunnerStatusLabel={buildRunnerStatusLabel}
                        buildDeviceStatusClass={buildDeviceStatusClass}
                        buildDeviceStatusLabel={buildDeviceStatusLabel}
                        t={t}
                    />
                )}
            </section>

            <RunnerTroubleshootingSection
                isLoading={isLoading}
                runners={runners}
                offlineRunners={offlineRunners}
                copiedCommandKey={copiedCommandKey}
                onCopyCommand={copyCommand}
                buildPairCommand={buildPairCommand}
                resolveRunnerDisplayId={resolveRunnerDisplayId}
                buildStartRunnerCommand={buildStartRunnerCommand}
                copyLabel={copyLabel}
                copiedLabel={copiedLabel}
                t={t}
            />
        </div>
    );
}
