'use client';

import { useState } from 'react';
import { Button, CenteredLoading, Modal } from '@/components/shared';
import { useProjectSchedules } from '../hooks/useProjectSchedules';
import { scheduleToUpsertInput, type ProjectScheduleTestCaseOption } from '../model/schedule-form';
import ScheduleEditor from './ScheduleEditor';
import ScheduleReadRow from './ScheduleReadRow';

interface ProjectSchedulesPanelProps {
    projectId: string;
    canManageProject: boolean;
    availableTestCases: ProjectScheduleTestCaseOption[];
    t: (key: string, values?: Record<string, string | number>) => string;
}

export default function ProjectSchedulesPanel({
    projectId,
    canManageProject,
    availableTestCases,
    t,
}: ProjectSchedulesPanelProps) {
    const {
        schedules,
        isLoading,
        error,
        createSchedule,
        updateSchedule,
        deleteSchedule,
    } = useProjectSchedules(projectId);
    const [editingId, setEditingId] = useState<string | 'new' | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [togglingId, setTogglingId] = useState<string | null>(null);

    if (isLoading) {
        return <CenteredLoading className="py-12" />;
    }

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <Modal
                isOpen={deleteId !== null}
                onClose={() => setDeleteId(null)}
                title={t('project.scheduler.deleteTitle')}
                onConfirm={() => {
                    if (!deleteId) {
                        return;
                    }
                    void deleteSchedule(deleteId);
                    setDeleteId(null);
                }}
                confirmText={t('common.delete')}
                confirmVariant="danger"
            >
                <p className="text-sm text-gray-700">{t('project.scheduler.deleteBody')}</p>
            </Modal>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">{t('project.scheduler.title')}</h2>
                    <p className="mt-1 text-sm text-gray-500">{t('project.scheduler.description')}</p>
                </div>
                {canManageProject && editingId !== 'new' && (
                    <Button variant="primary" size="sm" onClick={() => setEditingId('new')}>
                        {t('project.scheduler.add')}
                    </Button>
                )}
            </div>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

            <div className="mt-6 space-y-4">
                {editingId === 'new' && (
                    <ScheduleEditor
                        projectId={projectId}
                        availableTestCases={availableTestCases}
                        isSaving={isSaving}
                        t={t}
                        onCancel={() => setEditingId(null)}
                        onSave={async (input) => {
                            setIsSaving(true);
                            try {
                                const created = await createSchedule(input);
                                if (created) {
                                    setEditingId(null);
                                }
                            } finally {
                                setIsSaving(false);
                            }
                        }}
                    />
                )}

                {schedules.length === 0 && editingId !== 'new' && (
                    <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
                        {t('project.scheduler.empty')}
                    </div>
                )}

                {schedules.map((schedule) => (
                    editingId === schedule.id ? (
                        <ScheduleEditor
                            key={schedule.id}
                            projectId={projectId}
                            schedule={schedule}
                            availableTestCases={availableTestCases}
                            isSaving={isSaving}
                            t={t}
                            onCancel={() => setEditingId(null)}
                            onSave={async (input) => {
                                setIsSaving(true);
                                try {
                                    const updated = await updateSchedule(schedule.id, input);
                                    if (updated) {
                                        setEditingId(null);
                                    }
                                } finally {
                                    setIsSaving(false);
                                }
                            }}
                        />
                    ) : (
                        <ScheduleReadRow
                            key={schedule.id}
                            schedule={schedule}
                            canManageProject={canManageProject}
                            isToggling={togglingId === schedule.id}
                            t={t}
                            onEdit={() => setEditingId(schedule.id)}
                            onToggleEnabled={async () => {
                                setTogglingId(schedule.id);
                                try {
                                    await updateSchedule(schedule.id, {
                                        ...scheduleToUpsertInput(schedule),
                                        enabled: !schedule.enabled,
                                    });
                                } finally {
                                    setTogglingId(null);
                                }
                            }}
                            onDelete={() => setDeleteId(schedule.id)}
                        />
                    )
                ))}
            </div>
        </div>
    );
}
