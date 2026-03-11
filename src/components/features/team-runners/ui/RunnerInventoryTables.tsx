'use client';

import { DangerTextButton } from '@/components/shared';
import type {
    TeamDeviceItem,
    TeamDevicesResponse,
    TeamRunnerItem,
    TeamRunnersResponse,
} from '../model/types';

interface RunnerInventoryTablesProps {
    runners: TeamRunnersResponse;
    devices: TeamDevicesResponse;
    pendingUnpairRunnerId: string | null;
    onRequestUnpair: (runner: TeamRunnerItem) => void;
    resolveRunnerKindLabel: (kind: string) => string;
    buildRunnerStatusClass: (runner: TeamRunnerItem) => string;
    buildRunnerStatusLabel: (runner: TeamRunnerItem, t: (key: string) => string) => string;
    buildDeviceStatusClass: (device: TeamDeviceItem) => string;
    buildDeviceStatusLabel: (device: TeamDeviceItem, t: (key: string) => string) => string;
    t: (key: string) => string;
}

export default function RunnerInventoryTables({
    runners,
    devices,
    pendingUnpairRunnerId,
    onRequestUnpair,
    resolveRunnerKindLabel,
    buildRunnerStatusClass,
    buildRunnerStatusLabel,
    buildDeviceStatusClass,
    buildDeviceStatusLabel,
    t,
}: RunnerInventoryTablesProps) {
    return (
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
                                                <DangerTextButton
                                                    onClick={() => onRequestUnpair(runner)}
                                                    disabled={pendingUnpairRunnerId !== null}
                                                    size="sm"
                                                    className="disabled:text-red-300"
                                                >
                                                    {pendingUnpairRunnerId === runner.id
                                                        ? t('team.runners.unpair.loading')
                                                        : t('team.runners.unpair')}
                                                </DangerTextButton>
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
    );
}

export type { RunnerInventoryTablesProps };
