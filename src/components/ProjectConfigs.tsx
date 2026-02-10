'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType } from '@/types';

interface ProjectConfigsProps {
    projectId: string;
}

const CONFIG_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;

const TYPE_SECTIONS: { type: ConfigType; titleKey: string }[] = [
    { type: 'URL', titleKey: 'configs.title.urls' },
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

export default function ProjectConfigs({ projectId }: ProjectConfigsProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [configs, setConfigs] = useState<ConfigItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editState, setEditState] = useState<EditState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());

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

        if (!editState.name.trim()) {
            setError(t('configs.error.nameRequired'));
            return;
        }
        if (!CONFIG_NAME_REGEX.test(editState.name)) {
            setError(t('configs.error.invalidName'));
            return;
        }
        if (editState.type !== 'FILE' && !editState.value.trim()) {
            setError(t('configs.error.valueRequired'));
            return;
        }

        const duplicate = configs.find(c => c.name === editState.name && c.id !== editState.id);
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
                    body: JSON.stringify({ name: editState.name, type: editState.type, value: editState.value }),
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
                    body: JSON.stringify({ name: editState.name, type: editState.type, value: editState.value }),
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
        if (!confirm(t('configs.delete.confirm'))) return;

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

    const handleFileUpload = async (type: ConfigType) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;

            const name = prompt(t('configs.name'), file.name.replace(/[^A-Z0-9_]/gi, '_').toUpperCase());
            if (!name) return;

            if (!CONFIG_NAME_REGEX.test(name)) {
                alert(t('configs.error.invalidName'));
                return;
            }

            const formData = new FormData();
            formData.append('file', file);
            formData.append('name', name);

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
                    alert(data.error || 'Upload failed');
                    return;
                }
                await fetchConfigs();
            } catch (err) {
                console.error('Failed to upload file', err);
            }
        };
        input.click();
    };

    const copyReference = (config: ConfigItem) => {
        const ref = config.type === 'FILE'
            ? `{{file:${config.filename || config.name}}}`
            : `{{${config.name}}}`;
        navigator.clipboard.writeText(ref);
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
            {TYPE_SECTIONS.map(({ type, titleKey }) => {
                const items = configs.filter(c => c.type === type);
                const isEditing = editState?.type === type && !editState.id;

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
                                        handleFileUpload(type);
                                    } else {
                                        setEditState({ name: '', value: '', type });
                                        setError(null);
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
                                        <div key={item.id} className="p-4 bg-blue-50/50">
                                            <div className="flex gap-3 items-start">
                                                <input
                                                    type="text"
                                                    value={editState.name}
                                                    onChange={(e) => setEditState({ ...editState, name: e.target.value.toUpperCase() })}
                                                    placeholder={t('configs.name.placeholder')}
                                                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                                />
                                                <input
                                                    type={type === 'SECRET' ? 'password' : 'text'}
                                                    value={editState.value}
                                                    onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                                    placeholder={type === 'URL' ? t('configs.url.placeholder') : type === 'SECRET' ? t('configs.secret.placeholder') : t('configs.value.placeholder')}
                                                    className="flex-[2] px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                                />
                                                <button onClick={handleSave} className="px-3 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90">{t('common.save')}</button>
                                                <button onClick={() => { setEditState(null); setError(null); }} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
                                            </div>
                                            {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
                                        </div>
                                    );
                                }

                                return (
                                    <div key={item.id} className="flex items-center justify-between px-4 py-3 group hover:bg-gray-50">
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <code className="text-sm font-mono text-gray-800 font-medium">{item.name}</code>
                                            <span className="text-sm text-gray-500 truncate">
                                                {type === 'SECRET'
                                                    ? (revealedSecrets.has(item.id) ? item.value || '••••••' : '••••••')
                                                    : type === 'FILE'
                                                        ? item.filename
                                                        : item.value}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {type === 'SECRET' && (
                                                <button
                                                    type="button"
                                                    onClick={() => setRevealedSecrets(prev => {
                                                        const next = new Set(prev);
                                                        next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                                                        return next;
                                                    })}
                                                    className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                                                >
                                                    {revealedSecrets.has(item.id) ? t('common.hide') : t('common.show')}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => copyReference(item)}
                                                className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                                                title={t('configs.copyRef')}
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                </svg>
                                            </button>
                                            {type !== 'FILE' && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setEditState({ id: item.id, name: item.name, value: item.value, type: item.type }); setError(null); }}
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
                                <div className="p-4 bg-blue-50/50">
                                    <div className="flex gap-3 items-start">
                                        <input
                                            type="text"
                                            value={editState.name}
                                            onChange={(e) => setEditState({ ...editState, name: e.target.value.toUpperCase() })}
                                            placeholder={t('configs.name.placeholder')}
                                            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                            autoFocus
                                        />
                                        <input
                                            type={type === 'SECRET' ? 'password' : 'text'}
                                            value={editState.value}
                                            onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                            placeholder={type === 'URL' ? t('configs.url.placeholder') : type === 'SECRET' ? t('configs.secret.placeholder') : t('configs.value.placeholder')}
                                            className="flex-[2] px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                        />
                                        <button onClick={handleSave} className="px-3 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90">{t('common.save')}</button>
                                        <button onClick={() => { setEditState(null); setError(null); }} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
                                    </div>
                                    {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
                                </div>
                            )}

                            {items.length === 0 && !isEditing && (
                                <div className="px-4 py-6 text-center text-sm text-gray-400">
                                    —
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}

            <p className="text-xs text-gray-500 text-center">{t('configs.hint')}</p>
        </div>
    );
}
