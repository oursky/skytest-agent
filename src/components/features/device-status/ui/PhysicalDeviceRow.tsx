import type { AndroidDevicePoolStatusItem } from '@/lib/android/device-manager';
import type { ConnectedAndroidDeviceInfo } from '@/lib/android/device-display';
import { useI18n } from '@/i18n';
import DeviceRunLink from './DeviceRunLink';
import { buildConnectedDeviceDetail, buildConnectedDeviceTitle } from '../model/connected-device-presentation';
import { getConnectedDeviceBadge, isDeviceInUseByCurrentProject } from '../model/state-utils';

interface PhysicalDeviceRowProps {
    connected: ConnectedAndroidDeviceInfo;
    runtime?: AndroidDevicePoolStatusItem;
    projectId: string;
}

export default function PhysicalDeviceRow({ connected, runtime, projectId }: PhysicalDeviceRowProps) {
    const { t } = useI18n();
    const badge = getConnectedDeviceBadge(connected, runtime, projectId);

    return (
        <div className="px-4 py-3">
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
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
                        {t(badge.key)}
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
}
