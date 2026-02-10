'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType } from '@/types';
import Link from 'next/link';

const CONFIG_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;

interface ConfigurationsSectionProps {
    projectId: string;
    projectConfigs: ConfigItem[];
    testCaseConfigs: ConfigItem[];
    testCaseId?: string;
    onTestCaseConfigsChange: () => void;
    readOnly?: boolean;
}

interface EditState {
    id?: string;
    name: string;
    value: string;
    type: ConfigType;
}

export default function ConfigurationsSection({
    projectId,
    projectConfigs,
    testCaseConfigs,
    testCaseId,
    onTestCaseConfigsChange,
    readOnly,
}: ConfigurationsSectionProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [isExpanded, setIsExpanded] = useState(false);
    const [editState, setEditState] = useState<EditState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [addTypeOpen, setAddTypeOpen] = useState(false);

    const totalCount = projectConfigs.length + testCaseConfigs.length;

    const handleSave = useCallback(async () => {
        if (!editState || !testCaseId) return;
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

        try {
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            };

            if (editState.id) {
                const res = await fetch(`/api/test-cases/${testCaseId}/configs/${editState.id}`, {
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
                const res = await fetch(`/api/test-cases/${testCaseId}/configs`, {
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
            onTestCaseConfigsChange();
        } catch (err) {
            console.error('Failed to save config', err);
            setError('Failed to save');
        }
    }, [editState, testCaseId, getAccessToken, onTestCaseConfigsChange, t]);

    const handleDelete = useCallback(async (configId: string) => {
        if (!testCaseId) return;

        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            await fetch(`/api/test-cases/${testCaseId}/configs/${configId}`, {
                method: 'DELETE',
                headers,
            });
            onTestCaseConfigsChange();
        } catch (err) {
            console.error('Failed to delete config', err);
        }
    }, [testCaseId, getAccessToken, onTestCaseConfigsChange]);

    const getTypeIcon = (type: ConfigType) => {
        switch (type) {
            case 'URL': return '🔗';
            case 'VARIABLE': return '📝';
            case 'SECRET': return '🔒';
            case 'FILE': return '📎';
        }
    };

    const overriddenNames = new Set(testCaseConfigs.map(c => c.name));

    return (
        <div className="border border-gray-200 rounded-lg bg-white">
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-medium text-gray-700">{t('configs.snapshot.title')}</span>
                    {totalCount > 0 && (
                        <span className="text-xs text-gray-400">
                            ({t('configs.section.count', { projectCount: projectConfigs.length.toString(), testCaseCount: testCaseConfigs.length.toString() })})
                        </span>
                    )}
                </div>
            </button>

            {isExpanded && (
                <div className="border-t border-gray-200 divide-y divide-gray-100">
                    {/* Project configs (read-only) */}
                    {projectConfigs.length > 0 && (
                        <div className="px-4 py-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('configs.section.project')}</span>
                                <Link
                                    href={`/projects/${projectId}?tab=configs`}
                                    className="text-xs text-primary hover:text-primary/80"
                                >
                                    {t('configs.manage')} →
                                </Link>
                            </div>
                            <div className="space-y-1">
                                {projectConfigs.map(config => (
                                    <div
                                        key={config.id}
                                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${overriddenNames.has(config.name) ? 'opacity-50 line-through' : ''}`}
                                    >
                                        <span>{getTypeIcon(config.type)}</span>
                                        <code className="font-mono text-gray-800 text-xs">{config.name}</code>
                                        <span className="text-gray-400 text-xs truncate">
                                            {config.type === 'SECRET' ? '••••••' : config.type === 'FILE' ? config.filename : config.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Test case configs (editable) */}
                    <div className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('configs.section.testCase')}</span>
                            {!readOnly && testCaseId && (
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => setAddTypeOpen(!addTypeOpen)}
                                        className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                        {t('configs.add')}
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                    {addTypeOpen && (
                                        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 py-1 min-w-[120px]">
                                            {(['URL', 'VARIABLE', 'SECRET'] as ConfigType[]).map(type => (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => {
                                                        setEditState({ name: '', value: '', type });
                                                        setError(null);
                                                        setAddTypeOpen(false);
                                                    }}
                                                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                                                >
                                                    <span>{getTypeIcon(type)}</span>
                                                    {t(`configs.type.${type.toLowerCase()}`)}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="space-y-1">
                            {testCaseConfigs.map(config => {
                                const isEditingThis = editState?.id === config.id;
                                const overridesProject = projectConfigs.some(pc => pc.name === config.name);

                                if (isEditingThis && editState) {
                                    return (
                                        <div key={config.id} className="p-2 bg-blue-50/50 rounded">
                                            <div className="flex gap-2 items-start">
                                                <input
                                                    type="text"
                                                    value={editState.name}
                                                    onChange={(e) => setEditState({ ...editState, name: e.target.value.toUpperCase() })}
                                                    placeholder={t('configs.name.placeholder')}
                                                    className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                                <input
                                                    type={config.type === 'SECRET' ? 'password' : 'text'}
                                                    value={editState.value}
                                                    onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                                    placeholder={t('configs.value.placeholder')}
                                                    className="flex-[2] px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                                <button onClick={handleSave} className="px-2 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90">{t('common.save')}</button>
                                                <button onClick={() => { setEditState(null); setError(null); }} className="px-2 py-1.5 text-xs text-gray-500">{t('common.cancel')}</button>
                                            </div>
                                            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                                        </div>
                                    );
                                }

                                return (
                                    <div key={config.id} className="flex items-center gap-2 px-2 py-1.5 rounded text-sm group hover:bg-gray-50">
                                        <span>{getTypeIcon(config.type)}</span>
                                        <code className="font-mono text-gray-800 text-xs">{config.name}</code>
                                        <span className="text-gray-400 text-xs truncate">
                                            {config.type === 'SECRET' ? '••••••' : config.value}
                                        </span>
                                        {overridesProject && (
                                            <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{t('configs.override')}</span>
                                        )}
                                        {!readOnly && (
                                            <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    type="button"
                                                    onClick={() => { setEditState({ id: config.id, name: config.name, value: config.value, type: config.type }); setError(null); }}
                                                    className="p-1 text-gray-400 hover:text-gray-600"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(config.id)}
                                                    className="p-1 text-gray-400 hover:text-red-500"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {editState && !editState.id && (
                                <div className="p-2 bg-blue-50/50 rounded">
                                    <div className="flex gap-2 items-start">
                                        <input
                                            type="text"
                                            value={editState.name}
                                            onChange={(e) => setEditState({ ...editState, name: e.target.value.toUpperCase() })}
                                            placeholder={t('configs.name.placeholder')}
                                            className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                            autoFocus
                                        />
                                        <input
                                            type={editState.type === 'SECRET' ? 'password' : 'text'}
                                            value={editState.value}
                                            onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                            placeholder={editState.type === 'URL' ? t('configs.url.placeholder') : editState.type === 'SECRET' ? t('configs.secret.placeholder') : t('configs.value.placeholder')}
                                            className="flex-[2] px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                        <button onClick={handleSave} className="px-2 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90">{t('common.save')}</button>
                                        <button onClick={() => { setEditState(null); setError(null); }} className="px-2 py-1.5 text-xs text-gray-500">{t('common.cancel')}</button>
                                    </div>
                                    {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                                </div>
                            )}

                            {testCaseConfigs.length === 0 && !editState && (
                                <p className="text-xs text-gray-400 py-1">—</p>
                            )}
                        </div>
                    </div>

                    <div className="px-4 py-2 bg-gray-50 space-y-2">
                        <p className="text-[11px] text-gray-500 leading-snug">{t('configs.hint.intro')}</p>
                        <div>
                            <p className="text-[11px] font-medium text-gray-700">{t('configs.hint.aiStep')}</p>
                            <code className="block bg-white border border-gray-200 px-2 py-1 rounded text-[11px] text-gray-600 whitespace-pre-wrap">{t('configs.hint.aiExample')}</code>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium text-gray-700">{t('configs.hint.codeStep')}</p>
                            <code className="block bg-white border border-gray-200 px-2 py-1 rounded text-[11px] text-gray-600 whitespace-pre-wrap">{t('configs.hint.codeExample')}</code>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
