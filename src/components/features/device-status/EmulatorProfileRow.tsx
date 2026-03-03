import type { EmulatorRow } from './types';
import { DEVICE_STATE_COLORS } from '@/utils/deviceStateColors';
import { useI18n } from '@/i18n';
import { getInventoryOnlyStatusColorClass, getInventoryOnlyStatusKey } from '@/components/features/configurations/sections/device-utils';
import DeviceRunLink from './DeviceRunLink';
import { DEVICE_STATE_LABEL_KEYS, formatCountdown, isDeviceInUseByCurrentProject } from './state-utils';

interface EmulatorProfileRowProps {
    row: EmulatorRow;
    projectId: string;
    nowMs: number;
    stoppingDevices: Set<string>;
    bootingProfiles: Set<string>;
    onStop: (args: { deviceId?: string; serial?: string }) => Promise<void>;
    onBoot: (emulatorProfileName: string) => Promise<void>;
}

export default function EmulatorProfileRow({
    row,
    projectId,
    nowMs,
    stoppingDevices,
    bootingProfiles,
    onStop,
    onBoot,
}: EmulatorProfileRowProps) {
    const { t } = useI18n();
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
            ? (isBootingThisProfile ? 'device.state.booting' : getInventoryOnlyStatusKey(connected))
        : isBootingThisProfile
            ? 'device.state.booting'
            : 'device.notRunning';

    const badgeColor = emulator
        ? DEVICE_STATE_COLORS[emulator.state]
        : isStoppingConnectedEmulator
            ? DEVICE_STATE_COLORS.STOPPING
        : connected
            ? getInventoryOnlyStatusColorClass(connected)
        : isBootingThisProfile
            ? DEVICE_STATE_COLORS.BOOTING
            : 'bg-gray-100 text-gray-600';

    const idleCountdown = emulator?.state === 'IDLE' && typeof emulator.idleDeadlineAt === 'number'
        ? formatCountdown(emulator.idleDeadlineAt - nowMs)
        : null;

    return (
        <div className="px-4 py-3">
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
                                    onClick={() => void onStop({ deviceId: emulator.id })}
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
                            onClick={() => void onBoot(bootProfileName)}
                            disabled={bootingProfiles.has(bootProfileName)}
                            className="text-xs px-2 py-1 text-blue-700 border border-blue-200 rounded hover:bg-blue-50 disabled:opacity-50"
                        >
                            {t('device.bootWindow')}
                        </button>
                    )}
                    {!emulator && connected?.adbState === 'device' && (
                        <button
                            type="button"
                            onClick={() => void onStop({ serial: connected.serial })}
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
    );
}
