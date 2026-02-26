'use client';

import DeviceStatusPanel from '@/components/DeviceStatusPanel';

interface AndroidSetupProps {
    projectId: string;
}

export default function AndroidSetup({ projectId }: AndroidSetupProps) {
    return (
        <div className="space-y-8">
            <DeviceStatusPanel projectId={projectId} />
        </div>
    );
}
