'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType } from '@/types';
import { compareByGroupThenName, isGroupableConfigType, normalizeConfigGroup } from '@/lib/config/sort';
import { normalizeConfigName } from '@/lib/config/validation';
import GroupSelectInput from './GroupSelectInput';
import ConfigHints from './config-shared/ConfigHints';
import ConfigInlineEditor from './project-configs/ConfigInlineEditor';
import type { ProjectConfigEditState, ProjectConfigFileUploadDraft } from './project-configs/types';
import {
    buildAuthHeaders,
    buildConfigDisplayValue,
    buildConfigDownloadEndpoint,
    buildConfigGroupEndpoint,
    buildConfigItemEndpoint,
    buildConfigsEndpoint,
    buildConfigUploadEndpoint,
    collectConfigGroupOptions,
    getConfigTypeTitleKey,
} from './config-shared/config-utils';

interface ProjectConfigsProps {
    projectId: string;
}

const TYPE_SECTIONS: ConfigType[] = ['URL', 'APP_ID', 'VARIABLE', 'RANDOM_STRING', 'FILE'];

function normalizeConfigTypeItems(items: ConfigItem[]): ConfigItem[] {
    return [...items].sort(compareByGroupThenName);
}

function isMaskableConfig(type: ConfigType): boolean {
    return type === 'VARIABLE';
}

function isGroupInputEnabled(type: ConfigType): boolean {
    return isGroupableConfigType(type);
}

export default function ProjectConfigs({ projectId }: ProjectConfigsProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [configs, setConfigs] = useState<ConfigItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editState, setEditState] = useState<ProjectConfigEditState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fileUploadDraft, setFileUploadDraft] = useState<ProjectConfigFileUploadDraft | null>(null);

    const fetchConfigs = useCallback(async () => {
        try {
            const token = await getAccessToken();
            const response = await fetch(
                buildConfigsEndpoint({ kind: 'project', id: projectId }),
                { headers: buildAuthHeaders(token) }
            );
            if (!response.ok) {
                return;
            }
            setConfigs(await response.json());
        } catch (fetchError) {
            console.error('Failed to fetch configs', fetchError);
        } finally {
            setIsLoading(false);
        }
    }, [getAccessToken, projectId]);

    useEffect(() => {
        void fetchConfigs();
    }, [fetchConfigs]);

    const groupOptions = useMemo(() => {
        return collectConfigGroupOptions(configs);
    }, [configs]);

    const handleRemoveGroup = useCallback(async (group: string) => {
        const normalizedGroup = normalizeConfigGroup(group);
        if (!normalizedGroup) return;

        try {
            const token = await getAccessToken();
            const response = await fetch(buildConfigGroupEndpoint({ kind: 'project', id: projectId }), {
                method: 'DELETE',
                headers: buildAuthHeaders(token, true),
                body: JSON.stringify({ group: normalizedGroup }),
            });

            if (!response.ok) {
                throw new Error('Failed to remove group');
            }

            setEditState((prev) => {
                if (!prev) return prev;
                return normalizeConfigGroup(prev.group) === normalizedGroup
                    ? { ...prev, group: '' }
                    : prev;
            });
            setFileUploadDraft((prev) => {
                if (!prev) return prev;
                return normalizeConfigGroup(prev.group) === normalizedGroup
                    ? { ...prev, group: '' }
                    : prev;
            });
            await fetchConfigs();
        } catch (removeError) {
            console.error('Failed to remove group', removeError);
            setError(t('configs.error.removeGroupFailed'));
        }
    }, [fetchConfigs, getAccessToken, projectId, t]);

    const handleSave = async () => {
        if (!editState) return;
        setError(null);

        const normalizedName = normalizeConfigName(editState.name);
        if (!normalizedName) {
            setError(t('configs.error.nameRequired'));
            return;
        }
        if (editState.type !== 'FILE' && !editState.value.trim()) {
            setError(t('configs.error.valueRequired'));
            return;
        }

        const duplicate = configs.find((config) => config.name === normalizedName && config.id !== editState.id);
        if (duplicate) {
            setError(t('configs.error.nameTaken'));
            return;
        }

        const payload = {
            name: normalizedName,
            type: editState.type,
            value: editState.value,
            masked: isMaskableConfig(editState.type) ? editState.masked : false,
            group: isGroupInputEnabled(editState.type) ? normalizeConfigGroup(editState.group) : null,
        };

        try {
            const token = await getAccessToken();
            const response = await fetch(
                editState.id
                    ? buildConfigItemEndpoint({ kind: 'project', id: projectId }, editState.id)
                    : buildConfigsEndpoint({ kind: 'project', id: projectId }),
                {
                    method: editState.id ? 'PUT' : 'POST',
                    headers: buildAuthHeaders(token, true),
                    body: JSON.stringify(payload),
                }
            );

            if (!response.ok) {
                const data = await response.json().catch(() => ({} as { error?: string }));
                setError(data.error || 'Failed to save');
                return;
            }

            setEditState(null);
            await fetchConfigs();
        } catch (saveError) {
            console.error('Failed to save config', saveError);
            setError('Failed to save');
        }
    };

    const handleDelete = async (configId: string) => {
        try {
            const token = await getAccessToken();
            await fetch(buildConfigItemEndpoint({ kind: 'project', id: projectId }, configId), {
                method: 'DELETE',
                headers: buildAuthHeaders(token),
            });
            await fetchConfigs();
        } catch (deleteError) {
            console.error('Failed to delete config', deleteError);
        }
    };

    const handleDownload = async (config: ConfigItem) => {
        try {
            const token = await getAccessToken();
            const response = await fetch(
                buildConfigDownloadEndpoint({ kind: 'project', id: projectId }, config.id),
                { headers: buildAuthHeaders(token) }
            );
            if (!response.ok) return;

            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = config.filename || config.name;
            a.click();
            URL.revokeObjectURL(objectUrl);
        } catch (downloadError) {
            console.error('Failed to download file', downloadError);
        }
    };

    const handleFileUploadSave = async (draft: ProjectConfigFileUploadDraft | null = fileUploadDraft) => {
        if (!draft) return;
        setError(null);

        const normalizedName = normalizeConfigName(draft.name);
        if (!normalizedName) {
            setError(t('configs.error.nameRequired'));
            return;
        }
        if (!draft.file) {
            setError(t('configs.error.fileRequired'));
            return;
        }

        const duplicate = configs.find((config) => config.name === normalizedName);
        if (duplicate) {
            setError(t('configs.error.nameTaken'));
            return;
        }

        const formData = new FormData();
        formData.append('file', draft.file);
        formData.append('name', normalizedName);
        formData.append('group', normalizeConfigGroup(draft.group));

        try {
            const token = await getAccessToken();
            const response = await fetch(buildConfigUploadEndpoint({ kind: 'project', id: projectId }), {
                method: 'POST',
                headers: buildAuthHeaders(token),
                body: formData,
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({} as { error?: string }));
                setError(data.error || 'Upload failed');
                return;
            }
            setFileUploadDraft(null);
            await fetchConfigs();
        } catch (uploadError) {
            console.error('Failed to upload file', uploadError);
        }
    };

    const handleConfigEditorKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        void handleSave();
    };

    const startAdd = (type: ConfigType) => {
        if (type === 'FILE') {
            setEditState(null);
            setFileUploadDraft({ name: '', group: '', file: null });
            setError(null);
            return;
        }
        setFileUploadDraft(null);
        setEditState({
            name: '',
            value: type === 'RANDOM_STRING' ? 'TIMESTAMP_DATETIME' : '',
            type,
            masked: false,
            group: '',
        });
        setError(null);
    };

    const startEdit = (config: ConfigItem) => {
        setFileUploadDraft(null);
        setEditState({
            id: config.id,
            name: config.name,
            value: config.value,
            type: config.type,
            masked: config.masked === true,
            group: config.group || '',
        });
        setError(null);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <ConfigHints />

            {TYPE_SECTIONS
                .map((type) => {
                    const items = normalizeConfigTypeItems(configs.filter((config) => config.type === type));
                    const isAddingForType = editState?.type === type && !editState.id;
                    const isAddingFileForType = type === 'FILE' && fileUploadDraft !== null;

                    return (
                        <div key={type} className="bg-white rounded-lg shadow-sm border border-gray-200">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-sm font-semibold text-gray-700">{t(getConfigTypeTitleKey(type))}</h3>
                                    {items.length > 0 && (
                                        <span className="text-xs text-gray-400">({items.length})</span>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => startAdd(type)}
                                    className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    {t('configs.add')}
                                </button>
                            </div>

                            <div className="divide-y divide-gray-50">
                                {items.map((item) => {
                                    const isEditingThis = editState?.id === item.id;
                                    if (isEditingThis && editState) {
                                        return (
                                            <ConfigInlineEditor
                                                key={item.id}
                                                type={type}
                                                editState={editState}
                                                groupOptions={groupOptions}
                                                error={error}
                                                rowAlign="items-start"
                                                onKeyDown={handleConfigEditorKeyDown}
                                                onSave={handleSave}
                                                onCancel={() => { setEditState(null); setError(null); }}
                                                onRemoveGroup={handleRemoveGroup}
                                                onChange={setEditState}
                                            />
                                        );
                                    }

                                    return (
                                        <div key={item.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <code className="text-sm font-mono text-gray-800 font-medium">{item.name}</code>
                                                <span className="text-sm text-gray-500 truncate">{buildConfigDisplayValue(item)}</span>
                                                {item.group && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 uppercase">{item.group}</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {type === 'FILE' ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDownload(item)}
                                                        className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                                                        title={t('common.download')}
                                                    >
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                        </svg>
                                                    </button>
                                                ) : (
                                                    <button type="button" onClick={() => { startEdit(item); }} className="p-1.5 text-gray-400 hover:text-gray-600 rounded">
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                        </svg>
                                                    </button>
                                                )}
                                                <button type="button" onClick={() => handleDelete(item.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}

                                {isAddingForType && editState && (
                                    <ConfigInlineEditor
                                        type={type}
                                        editState={editState}
                                        groupOptions={groupOptions}
                                        error={error}
                                        autoFocus
                                        rowAlign="items-center"
                                        onKeyDown={handleConfigEditorKeyDown}
                                        onSave={handleSave}
                                        onCancel={() => { setEditState(null); setError(null); }}
                                        onRemoveGroup={handleRemoveGroup}
                                        onChange={setEditState}
                                    />
                                )}

                                {isAddingFileForType && fileUploadDraft && (
                                    <div className="p-4 bg-white space-y-2">
                                        <div className="flex gap-3 items-center">
                                            <input
                                                type="text"
                                                value={fileUploadDraft.name}
                                                onChange={(event) => setFileUploadDraft({ ...fileUploadDraft, name: event.target.value })}
                                                placeholder={t('configs.name.placeholder.enter')}
                                                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                                autoFocus
                                            />
                                            <input
                                                type="file"
                                                onChange={(event) => {
                                                    const selectedFile = event.target.files?.[0] || null;
                                                    const nextDraft = { ...fileUploadDraft, file: selectedFile };
                                                    setFileUploadDraft(nextDraft);
                                                    if (selectedFile) {
                                                        void handleFileUploadSave(nextDraft);
                                                    }
                                                }}
                                                className="flex-[2] px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent file:mr-3 file:px-3 file:py-1.5 file:border-0 file:rounded file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                                            />
                                            <button type="button" onClick={() => { setFileUploadDraft(null); setError(null); }} className="inline-flex items-center px-3 py-2 text-sm text-gray-500 hover:text-gray-700">
                                                {t('common.cancel')}
                                            </button>
                                        </div>
                                        <GroupSelectInput
                                            value={fileUploadDraft.group}
                                            onChange={(group) => setFileUploadDraft({ ...fileUploadDraft, group })}
                                            options={groupOptions}
                                            onRemoveOption={handleRemoveGroup}
                                            placeholder={t('configs.group.select')}
                                            containerClassName="relative w-full"
                                            inputClassName="min-h-[38px] text-sm"
                                        />
                                        {error && <p className="text-xs text-red-500">{error}</p>}
                                    </div>
                                )}

                                {items.length === 0 && !isAddingForType && !isAddingFileForType && (
                                    <div className="px-4 py-6 text-center text-sm text-gray-400">—</div>
                                )}
                            </div>
                        </div>
                    );
                })}
        </div>
    );
}
