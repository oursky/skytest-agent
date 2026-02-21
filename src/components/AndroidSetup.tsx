'use client';

import { useI18n } from '@/i18n';
import EmulatorStatusPanel from '@/components/EmulatorStatusPanel';

interface AndroidSetupProps {
    projectId: string;
}

export default function AndroidSetup({ projectId }: AndroidSetupProps) {
    const { t } = useI18n();
    void projectId;

    return (
        <div className="space-y-8">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 whitespace-pre-line">
                {t('android.setup.help')}
            </div>
            <EmulatorStatusPanel />
        </div>
    );
}
