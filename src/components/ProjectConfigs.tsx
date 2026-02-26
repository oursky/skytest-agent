'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType } from '@/types';

interface ProjectConfigsProps {
    projectId: string;
    androidEnabled?: boolean;
}

const CONFIG_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;

const TYPE_SECTIONS: { type: ConfigType; titleKey: string }[] = [
    { type: 'URL', titleKey: 'configs.title.urls' },
    { type: 'APP_ID', titleKey: 'configs.title.appIds' },
    { type: 'VARIABLE', titleKey: 'configs.title.variables' },
    { type: 'SECRET', titleKey: 'configs.title.secrets' },
    { type: 'FILE', titleKey: 'configs.title.files' },
];

interface EditState {
    id?: string;
    name: string;
    value: string;
    type: ConfigType;
}

interface FileUploadDraft {
    name: string;
    file: File | null;
}

export default function ProjectConfigs({ projectId, androidEnabled = false }: ProjectConfigsProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [configs, setConfigs] = useState<ConfigItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editState, setEditState] = useState<EditState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showSecretInEdit, setShowSecretInEdit] = useState(false);
    const [fileUploadDraft, setFileUploadDraft] = useState<FileUploadDraft | null>(null);

    const fetchConfigs = useCallback(async () => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/projects/${projectId}/configs`, { headers });
            if (res.ok) {
                setConfigs(await res.json());
            }
        } catch (err) {
            console.error('Failed to fetch configs', err);
        } finally {
            setIsLoading(false);
        }
    }, [projectId, getAccessToken]);

    useEffect(() => {
        fetchConfigs();
    }, [fetchConfigs]);

    const handleSave = async () => {
        if (!editState) return;
        setError(null);

        const normalizedName = editState.name.trim().toUpperCase();

        if (!normalizedName) {
            setError(t('configs.error.nameRequired'));
            return;
        }
        if (!CONFIG_NAME_REGEX.test(normalizedName)) {
            setError(t('configs.error.invalidName'));
            return;
        }
        if (editState.type !== 'FILE' && !editState.value.trim()) {
            setError(t('configs.error.valueRequired'));
            return;
        }

        const duplicate = configs.find(c => c.name === normalizedName && c.id !== editState.id);
        if (duplicate) {
            setError(t('configs.error.nameTaken'));
            return;
        }

        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            };

            if (editState.id) {
                const res = await fetch(`/api/projects/${projectId}/configs/${editState.id}`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ name: normalizedName, type: editState.type, value: editState.value }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setError(data.error || 'Failed to update');
                    return;
                }
            } else {
                const res = await fetch(`/api/projects/${projectId}/configs`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ name: normalizedName, type: editState.type, value: editState.value }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setError(data.error || 'Failed to create');
                    return;
                }
            }

            setEditState(null);
            await fetchConfigs();
        } catch (err) {
            console.error('Failed to save config', err);
            setError('Failed to save');
        }
    };

    const handleDelete = async (configId: string) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            await fetch(`/api/projects/${projectId}/configs/${configId}`, {
                method: 'DELETE',
                headers,
            });
            await fetchConfigs();
        } catch (err) {
            console.error('Failed to delete config', err);
        }
    };

    const handleFileUploadSave = async (draft: FileUploadDraft | null = fileUploadDraft) => {
        if (!draft) return;
        setError(null);

        const normalizedName = draft.name.trim().toUpperCase();
        if (!normalizedName) {
            setError(t('configs.error.nameRequired'));
            return;
        }
        if (!CONFIG_NAME_REGEX.test(normalizedName)) {
            setError(t('configs.error.invalidName'));
            return;
        }
        if (!draft.file) {
            setError(t('configs.error.fileRequired'));
            return;
        }

        const duplicate = configs.find(c => c.name === normalizedName);
        if (duplicate) {
            setError(t('configs.error.nameTaken'));
            return;
        }

        const formData = new FormData();
        formData.append('file', draft.file);
        formData.append('name', normalizedName);

        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/projects/${projectId}/configs/upload`, {
                method: 'POST',
                headers,
                body: formData,
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Upload failed');
                return;
            }
            setFileUploadDraft(null);
            await fetchConfigs();
        } catch (err) {
            console.error('Failed to upload file', err);
        }
    };

    const handleConfigEditorKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        void handleSave();
    };

    const handleDownload = async (config: ConfigItem) => {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/projects/${projectId}/configs/${config.id}/download`, { headers });
            if (!res.ok) return;
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = config.filename || config.name;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Failed to download file', err);
        }
    };

    const handleEdit = async (item: ConfigItem) => {
        setShowSecretInEdit(false);
        if (item.type === 'SECRET') {
            try {
                const token = await getAccessToken();
                const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
                const res = await fetch(`/api/projects/${projectId}/configs?includeSecretValues=true`, { headers });
                if (res.ok) {
                    const configsWithSecrets = await res.json();
                    const configWithSecret = configsWithSecrets.find((c: ConfigItem) => c.id === item.id);
                    if (configWithSecret) {
                        setEditState({ id: item.id, name: item.name, value: configWithSecret.value, type: item.type });
                        setError(null);
                        return;
                    }
                }
            } catch (err) {
                console.error('Failed to fetch secret value', err);
            }
        }
        setEditState({ id: item.id, name: item.name, value: item.value, type: item.type });
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
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 space-y-3">
                <p className="text-[11px] text-gray-500 leading-snug">
                    {t('configs.hint.intro')}
                </p>
                <div>
                    <p className="font-medium text-gray-700">{t('configs.hint.aiStep')}</p>
                    <code className="block bg-white border border-gray-200 px-2 py-1.5 rounded text-gray-600 whitespace-pre-wrap">{t('configs.hint.aiExample')}</code>
                </div>
                <div>
                    <p className="font-medium text-gray-700">{t('configs.hint.codeStep')}</p>
                    <code className="block bg-white border border-gray-200 px-2 py-1.5 rounded text-gray-600 whitespace-pre-wrap">{t('configs.hint.codeExample')}</code>
                </div>
            </div>
            {TYPE_SECTIONS
                .filter(({ type }) => androidEnabled || type !== 'APP_ID')
                .map(({ type, titleKey }) => {
                const items = configs.filter(c => c.type === type);
                const isEditing = editState?.type === type && !editState.id;
                const isFileUploadDraftActive = type === 'FILE' && fileUploadDraft !== null;

                return (
                    <div key={type} className="bg-white rounded-lg shadow-sm border border-gray-200">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-gray-700">{t(titleKey)}</h3>
                                {items.length > 0 && (
                                    <span className="text-xs text-gray-400">({items.length})</span>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (type === 'FILE') {
                                        setEditState(null);
                                        setShowSecretInEdit(false);
                                        setFileUploadDraft({ name: '', file: null });
                                        setError(null);
                                    } else {
                                        setFileUploadDraft(null);
                                        setEditState({ name: '', value: '', type });
                                        setError(null);
                                        setShowSecretInEdit(false);
                                    }
                                }}
                                className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                {t('configs.add')}
                            </button>
                        </div>

                        <div className="divide-y divide-gray-50">
                            {items.map(item => {
                                const isEditingThis = editState?.id === item.id;

                                if (isEditingThis) {
                                    return (
                                        <div key={item.id} className="p-4 bg-white">
                                            <div className="flex gap-3 items-start">
                                                <input
                                                    type="text"
                                                    value={editState.name}
                                                    onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                                                    onKeyDown={handleConfigEditorKeyDown}
                                                    placeholder={t(`configs.name.placeholder.${type.toLowerCase()}`)}
                                                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md font-mono bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                                />
                                                <div className="flex-[2] relative">
                                                    <input
                                                        type={type === 'SECRET' && !showSecretInEdit ? 'password' : 'text'}
                                                        value={editState.value}
                                                        onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                                        onKeyDown={handleConfigEditorKeyDown}
                                                        placeholder={type === 'URL' ? t('configs.url.placeholder') : type === 'SECRET' ? t('configs.secret.placeholder') : t('configs.value.placeholder')}
                                                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent pr-10"
                                                    />
                                                    {type === 'SECRET' && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowSecretInEdit(!showSecretInEdit)}
                                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                                                        >
                                                            {showSecretInEdit ? (
                                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                                </svg>
                                                            ) : (
                                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                                <button type="button" onClick={handleSave} className="px-3 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90">{t('common.save')}</button>
                                                <button type="button" onClick={() => { setEditState(null); setError(null); }} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
                                            </div>
                                            {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
                                        </div>
                                    );
                                }

                                return (
                                    <div key={item.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            {type === 'FILE' ? (
                                                <>
                                                    <code className="text-sm font-mono text-gray-800 font-medium">{item.name}</code>
                                                    <span className="text-sm text-gray-500 truncate">{item.filename || item.value}</span>
                                                </>
                                            ) : (
                                                <>
                                                    <code className="text-sm font-mono text-gray-800 font-medium">{item.name}</code>
                                                    <span className="text-sm text-gray-500 truncate">
                                                        {type === 'SECRET' ? '••••••' : item.value}
                                                    </span>
                                                </>
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
                                                <button
                                                    type="button"
                                                    onClick={() => handleEdit(item)}
                                                    className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(item.id)}
                                                className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}

                            {isEditing && (
                                <div className="p-4 bg-white">
                                    <div className="flex gap-3 items-center">
                                        <input
                                            type="text"
                                            value={editState.name}
                                            onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                                            onKeyDown={handleConfigEditorKeyDown}
                                            placeholder={t(`configs.name.placeholder.${type.toLowerCase()}`)}
                                            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md font-mono bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                            autoFocus
                                        />
                                        <div className="flex-[2] relative">
                                            <input
                                                type={type === 'SECRET' && !showSecretInEdit ? 'password' : 'text'}
                                                value={editState.value}
                                                onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                                onKeyDown={handleConfigEditorKeyDown}
                                                placeholder={type === 'URL' ? t('configs.url.placeholder') : type === 'SECRET' ? t('configs.secret.placeholder') : t('configs.value.placeholder')}
                                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent pr-10"
                                            />
                                            {type === 'SECRET' && (
                                                <button
                                                    type="button"
                                                    onClick={() => setShowSecretInEdit(!showSecretInEdit)}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                                                >
                                                    {showSecretInEdit ? (
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                        </svg>
                                                    ) : (
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                        </svg>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                        <button type="button" onClick={handleSave} className="px-3 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90">{t('common.save')}</button>
                                        <button type="button" onClick={() => { setEditState(null); setError(null); }} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
                                    </div>
                                    {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
                                </div>
                            )}

                            {isFileUploadDraftActive && fileUploadDraft && (
                                <div className="p-4 bg-white">
                                    <div className="flex gap-3 items-center">
                                        <input
                                            type="text"
                                            value={fileUploadDraft.name}
                                            onChange={(e) => setFileUploadDraft({ ...fileUploadDraft, name: e.target.value })}
                                            placeholder={t('configs.name.placeholder.file')}
                                            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md font-mono bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                            autoFocus
                                        />
                                        <div className="flex-[2]">
                                            <input
                                                type="file"
                                                onChange={(e) => {
                                                    const selectedFile = e.target.files?.[0] || null;
                                                    const nextDraft = { ...fileUploadDraft, file: selectedFile };
                                                    setFileUploadDraft(nextDraft);
                                                    if (selectedFile) {
                                                        void handleFileUploadSave(nextDraft);
                                                    }
                                                }}
                                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent file:mr-3 file:px-3 file:py-1.5 file:border-0 file:rounded file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setFileUploadDraft(null);
                                                setError(null);
                                            }}
                                            className="inline-flex items-center px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                                        >
                                            {t('common.cancel')}
                                        </button>
                                    </div>
                                    {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
                                </div>
                            )}

                            {items.length === 0 && !isEditing && !isFileUploadDraftActive && (
                                <div className="px-4 py-6 text-center text-sm text-gray-400">
                                    —
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}

        </div>
    );
}
