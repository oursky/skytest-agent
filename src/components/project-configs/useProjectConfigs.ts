import { useState, useEffect, useCallback, useMemo, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType } from '@/types';
import { isGroupableConfigType, normalizeConfigGroup } from '@/lib/config/sort';
import { normalizeConfigName } from '@/lib/config/validation';
import type { ProjectConfigEditState, ProjectConfigFileUploadDraft } from './types';
import {
    buildAuthHeaders,
    buildConfigDownloadEndpoint,
    buildConfigGroupEndpoint,
    buildConfigItemEndpoint,
    buildConfigsEndpoint,
    buildConfigUploadEndpoint,
    collectConfigGroupOptions,
} from '@/components/config-shared/config-utils';

function isMaskableConfig(type: ConfigType): boolean {
    return type === 'VARIABLE';
}

function isGroupInputEnabled(type: ConfigType): boolean {
    return isGroupableConfigType(type);
}

interface UseProjectConfigsResult {
    configs: ConfigItem[];
    isLoading: boolean;
    editState: ProjectConfigEditState | null;
    setEditState: Dispatch<SetStateAction<ProjectConfigEditState | null>>;
    error: string | null;
    setError: Dispatch<SetStateAction<string | null>>;
    fileUploadDraft: ProjectConfigFileUploadDraft | null;
    setFileUploadDraft: Dispatch<SetStateAction<ProjectConfigFileUploadDraft | null>>;
    groupOptions: string[];
    handleRemoveGroup: (group: string) => Promise<void>;
    handleSave: () => Promise<void>;
    handleDelete: (configId: string) => Promise<void>;
    handleDownload: (config: ConfigItem) => Promise<void>;
    handleFileUploadSave: (draft?: ProjectConfigFileUploadDraft | null) => Promise<void>;
    handleConfigEditorKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    startAdd: (type: ConfigType) => void;
    startEdit: (config: ConfigItem) => void;
}

export function useProjectConfigs(projectId: string): UseProjectConfigsResult {
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
            const response = await fetch(buildConfigsEndpoint({ kind: 'project', id: projectId }), {
                headers: buildAuthHeaders(token),
            });
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

    const groupOptions = useMemo(() => collectConfigGroupOptions(configs), [configs]);

    const handleRemoveGroup = useCallback(async (group: string) => {
        const normalizedGroup = normalizeConfigGroup(group);
        if (!normalizedGroup) {
            return;
        }

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

            setEditState((previous) => {
                if (!previous) return previous;
                return normalizeConfigGroup(previous.group) === normalizedGroup
                    ? { ...previous, group: '' }
                    : previous;
            });
            setFileUploadDraft((previous) => {
                if (!previous) return previous;
                return normalizeConfigGroup(previous.group) === normalizedGroup
                    ? { ...previous, group: '' }
                    : previous;
            });
            await fetchConfigs();
        } catch (removeError) {
            console.error('Failed to remove group', removeError);
            setError(t('configs.error.removeGroupFailed'));
        }
    }, [fetchConfigs, getAccessToken, projectId, t]);

    const handleSave = useCallback(async () => {
        if (!editState) {
            return;
        }

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
    }, [configs, editState, fetchConfigs, getAccessToken, projectId, t]);

    const handleDelete = useCallback(async (configId: string) => {
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
    }, [fetchConfigs, getAccessToken, projectId]);

    const handleDownload = useCallback(async (config: ConfigItem) => {
        try {
            const token = await getAccessToken();
            const response = await fetch(
                buildConfigDownloadEndpoint({ kind: 'project', id: projectId }, config.id),
                { headers: buildAuthHeaders(token) }
            );
            if (!response.ok) {
                return;
            }

            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = config.filename || config.name;
            anchor.click();
            URL.revokeObjectURL(objectUrl);
        } catch (downloadError) {
            console.error('Failed to download file', downloadError);
        }
    }, [getAccessToken, projectId]);

    const handleFileUploadSave = useCallback(async (draft: ProjectConfigFileUploadDraft | null = fileUploadDraft) => {
        if (!draft) {
            return;
        }

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
    }, [configs, fileUploadDraft, fetchConfigs, getAccessToken, projectId, t]);

    const handleConfigEditorKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        void handleSave();
    }, [handleSave]);

    const startAdd = useCallback((type: ConfigType) => {
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
    }, []);

    const startEdit = useCallback((config: ConfigItem) => {
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
    }, []);

    return {
        configs,
        isLoading,
        editState,
        setEditState,
        error,
        setError,
        fileUploadDraft,
        setFileUploadDraft,
        groupOptions,
        handleRemoveGroup,
        handleSave,
        handleDelete,
        handleDownload,
        handleFileUploadSave,
        handleConfigEditorKeyDown,
        startAdd,
        startEdit,
    };
}
