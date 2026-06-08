'use client';

import { ProjectSchedulesPanel } from '@/components/features/project-scheduler';
import type { ProjectSettingsPanelProps } from '@/components/features/projects/ui/ProjectSettingsPanel';
import ProjectSettingsPanel from '@/components/features/projects/ui/ProjectSettingsPanel';

interface ProjectSettingsTabProps extends ProjectSettingsPanelProps {
    projectId: string;
    testCases: Array<{
        id: string;
        displayId?: string;
        name: string;
    }>;
}

export default function ProjectSettingsTab({
    projectId,
    testCases,
    ...settingsPanelProps
}: ProjectSettingsTabProps) {
    return (
        <div className="space-y-6">
            <ProjectSchedulesPanel
                projectId={projectId}
                canManageProject={settingsPanelProps.canManageProject}
                availableTestCases={testCases}
                t={settingsPanelProps.t}
            />
            <ProjectSettingsPanel {...settingsPanelProps} />
        </div>
    );
}
