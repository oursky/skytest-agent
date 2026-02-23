'use client';

import EmulatorStatusPanel from '@/components/EmulatorStatusPanel';

interface AndroidSetupProps {
    projectId: string;
}

export default function AndroidSetup({ projectId }: AndroidSetupProps) {
    return (
        <div className="space-y-8">
            <EmulatorStatusPanel projectId={projectId} />
        </div>
    );
}
