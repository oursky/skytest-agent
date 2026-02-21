'use client';

import { useI18n } from '@/i18n';
import ApkManager from '@/components/ApkManager';
import AvdProfileManager from '@/components/AvdProfileManager';
import EmulatorStatusPanel from '@/components/EmulatorStatusPanel';

interface AndroidSetupProps {
    projectId: string;
}

export default function AndroidSetup({ projectId }: AndroidSetupProps) {
    const { t } = useI18n();

    return (
        <div className="space-y-8">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                {t('android.setup.help')}
            </div>
            <ApkManager projectId={projectId} />
            <AvdProfileManager projectId={projectId} />
            <EmulatorStatusPanel />
        </div>
    );
}
