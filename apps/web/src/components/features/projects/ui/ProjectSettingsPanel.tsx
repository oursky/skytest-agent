'use client';

import { Button } from '@/components/shared';

interface ProjectSettingsPanelProps {
    canManageProject: boolean;
    maxConcurrentRunsLimit?: number;
    maxConcurrentRunsInput: string;
    isEditing: boolean;
    isSaving: boolean;
    isSaveDisabled: boolean;
    settingsError: string;
    onInputChange: (value: string) => void;
    onEnterSave: () => void;
    onSave: () => void;
    onCancel: () => void;
    onStartEdit: () => void;
    t: (key: string, values?: Record<string, string | number>) => string;
}

export default function ProjectSettingsPanel({
    canManageProject,
    maxConcurrentRunsLimit,
    maxConcurrentRunsInput,
    isEditing,
    isSaving,
    isSaveDisabled,
    settingsError,
    onInputChange,
    onEnterSave,
    onSave,
    onCancel,
    onStartEdit,
    t,
}: ProjectSettingsPanelProps) {
    return (
        <div className="max-w-2xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">{t('project.settings.title')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('project.settings.description')}</p>

            <div className="mt-6 space-y-2">
                <label htmlFor="max-concurrent-runs" className="block text-sm font-medium text-gray-700">
                    {t('project.settings.concurrentRuns.label')}
                </label>
                <div className="flex flex-wrap items-center gap-3">
                    <input
                        id="max-concurrent-runs"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={maxConcurrentRunsLimit ?? 5}
                        value={maxConcurrentRunsInput}
                        onChange={(event) => onInputChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !isSaveDisabled) {
                                event.preventDefault();
                                onEnterSave();
                            }
                        }}
                        disabled={!canManageProject || !isEditing}
                        className="h-10 w-full max-w-sm rounded-md border border-gray-300 px-4 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:bg-gray-50"
                    />
                    {canManageProject && (
                        isEditing ? (
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    onClick={onSave}
                                    disabled={isSaveDisabled}
                                    variant="primary"
                                    size="sm"
                                >
                                    {isSaving ? t('project.settings.saving') : t('common.save')}
                                </Button>
                                <Button
                                    type="button"
                                    onClick={onCancel}
                                    variant="secondary"
                                    size="sm"
                                >
                                    {t('common.cancel')}
                                </Button>
                            </div>
                        ) : (
                            <Button
                                type="button"
                                onClick={onStartEdit}
                                variant="secondary"
                                size="sm"
                            >
                                {t('common.edit')}
                            </Button>
                        )
                    )}
                </div>
                <p className="text-xs text-gray-500">
                    {t('project.settings.concurrentRuns.help', { max: maxConcurrentRunsLimit ?? 5 })}
                </p>
            </div>

            {settingsError && (
                <p className="mt-3 text-sm text-red-600">{settingsError}</p>
            )}
        </div>
    );
}

export type { ProjectSettingsPanelProps };
