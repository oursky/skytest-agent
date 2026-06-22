'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import type { RunGroupSummary } from '@/types';

interface RunGroupSchedulePickerProps {
    projectId: string;
    selectedIds: string[];
    t: (key: string, values?: Record<string, string | number>) => string;
    onChange: (nextSelectedIds: string[]) => void;
}

export default function RunGroupSchedulePicker({ projectId, selectedIds, t, onChange }: RunGroupSchedulePickerProps) {
    const { getAccessToken } = useAuth();
    const [groups, setGroups] = useState<RunGroupSummary[]>([]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetchWithAccessToken(getAccessToken, `/api/projects/${projectId}/run-groups`);
                if (response.ok && !cancelled) {
                    setGroups(await response.json() as RunGroupSummary[]);
                }
            } catch {
                // Leave empty on failure; run groups are optional for a schedule.
            }
        })();
        return () => { cancelled = true; };
    }, [projectId, getAccessToken]);

    const toggle = (id: string) => {
        onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]);
    };

    if (groups.length === 0) {
        return <p className="text-xs text-gray-500">{t('project.scheduler.runGroups.empty')}</p>;
    }

    return (
        <div className="space-y-1 rounded-md border border-gray-200 p-2">
            {groups.map((group) => (
                <label key={group.id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                        type="checkbox"
                        checked={selectedIds.includes(group.id)}
                        onChange={() => toggle(group.id)}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    {group.displayId && <span className="font-mono text-xs text-gray-500">{group.displayId}</span>}
                    <span className="truncate">{group.name}</span>
                </label>
            ))}
        </div>
    );
}
