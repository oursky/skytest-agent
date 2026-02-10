'use client';

import { useState, useCallback, useRef } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType, BrowserConfig } from '@/types';
import Link from 'next/link';

const CONFIG_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;

const TYPE_ORDER: ConfigType[] = ['URL', 'VARIABLE', 'SECRET', 'FILE'];

interface BrowserEntry {
    id: string;
    config: BrowserConfig;
}

interface ConfigurationsSectionProps {
    projectId: string;
    projectConfigs: ConfigItem[];
    testCaseConfigs: ConfigItem[];
    testCaseId?: string;
    onTestCaseConfigsChange: () => void;
    readOnly?: boolean;
    browsers: BrowserEntry[];
    setBrowsers: (browsers: BrowserEntry[]) => void;
    mode: 'simple' | 'builder';
}

interface EditState {
    id?: string;
    name: string;
    value: string;
    type: ConfigType;
}

function sortConfigs(configs: ConfigItem[]): ConfigItem[] {
    return [...configs].sort((a, b) => {
        const typeA = TYPE_ORDER.indexOf(a.type);
        const typeB = TYPE_ORDER.indexOf(b.type);
        if (typeA !== typeB) return typeA - typeB;
        return a.name.localeCompare(b.name);
    });
}

function TypeSubHeader({ type, t }: { type: ConfigType; t: (key: string) => string }) {
    const key = type === 'URL' ? 'configs.title.urls'
        : type === 'VARIABLE' ? 'configs.title.variables'
            : type === 'SECRET' ? 'configs.title.secrets'
                : 'configs.title.files';
    return (
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-2 first:pt-0">
            {t(key)}
        </div>
    );
}

export default function ConfigurationsSection({
    projectId,
    projectConfigs,
    testCaseConfigs,
    testCaseId,
    onTestCaseConfigsChange,
    readOnly,
    browsers,
    setBrowsers,
    mode,
}: ConfigurationsSectionProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [isExpanded, setIsExpanded] = useState(false);
    const [editState, setEditState] = useState<EditState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [addTypeOpen, setAddTypeOpen] = useState(false);
    const [urlDropdownOpen, setUrlDropdownOpen] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const handleFileUpload = useCallback(async () => {
        if (!testCaseId) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;

            const name = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
            if (!CONFIG_NAME_REGEX.test(name)) {
                setError(t('configs.error.invalidName'));
                return;
            }

            const formData = new FormData();
            formData.append('file', file);
            formData.append('name', name);

            try {
                const token = await getAccessToken();
                const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
                const res = await fetch(`/api/test-cases/${testCaseId}/configs/upload`, {
                    method: 'POST',
                    headers,
                    body: formData,
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setError(data.error || 'Upload failed');
                    return;
                }
                onTestCaseConfigsChange();
            } catch (err) {
                console.error('Failed to upload file', err);
            }
        };
        input.click();
    }, [testCaseId, getAccessToken, onTestCaseConfigsChange, t]);

    const handleDownload = useCallback(async (config: ConfigItem) => {
        if (!testCaseId) return;
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/test-cases/${testCaseId}/configs/${config.id}/download`, { headers });
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
    }, [testCaseId, getAccessToken]);

    const handleAddBrowser = () => {
        const nextChar = String.fromCharCode('a'.charCodeAt(0) + browsers.length);
        const newId = `browser_${nextChar}`;
        setBrowsers([...browsers, { id: newId, config: { url: '' } }]);
    };

    const handleRemoveBrowser = (index: number) => {
        if (browsers.length <= 1) return;
        const newBrowsers = [...browsers];
        newBrowsers.splice(index, 1);
        setBrowsers(newBrowsers);
    };

    const updateBrowser = (index: number, field: keyof BrowserConfig, value: string) => {
        const newBrowsers = [...browsers];
        newBrowsers[index] = {
            ...newBrowsers[index],
            config: { ...newBrowsers[index].config, [field]: value }
        };
        setBrowsers(newBrowsers);
    };

    const overriddenNames = new Set(testCaseConfigs.map(c => c.name));
    const sortedProjectConfigs = sortConfigs(projectConfigs);
    const sortedTestCaseConfigs = sortConfigs(testCaseConfigs);

    const urlConfigs = [...projectConfigs, ...testCaseConfigs].filter(c => c.type === 'URL');

    const colors = ['bg-blue-500', 'bg-purple-500', 'bg-orange-500', 'bg-green-500', 'bg-pink-500'];

    const renderConfigsByType = (configs: ConfigItem[], renderItem: (config: ConfigItem, type: ConfigType) => React.ReactNode) => {
        let lastType: ConfigType | null = null;
        const elements: React.ReactNode[] = [];
        for (const config of configs) {
            if (config.type !== lastType) {
                elements.push(<TypeSubHeader key={`header-${config.type}`} type={config.type} t={t} />);
                lastType = config.type;
            }
            elements.push(renderItem(config, config.type));
        }
        return elements;
    };

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
                </div>
            </button>

            {isExpanded && (
                <div className="border-t border-gray-200 divide-y divide-gray-100">
                    {/* Section 1: Project Variables (read-only) */}
                    <div className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('configs.section.projectVariables')}</span>
                            <Link
                                href={`/projects/${projectId}?tab=configs`}
                                className="text-xs text-primary hover:text-primary/80"
                            >
                                {t('configs.manage')} →
                            </Link>
                        </div>
                        {projectConfigs.length > 0 ? (
                            <div className="space-y-0.5">
                                {renderConfigsByType(sortedProjectConfigs, (config) => (
                                    <div
                                        key={config.id}
                                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${overriddenNames.has(config.name) ? 'opacity-50 line-through' : ''}`}
                                    >
                                        <code className="font-mono text-gray-800 text-xs">{config.name}</code>
                                        <span className="text-gray-400 text-xs truncate">
                                            {config.type === 'SECRET' ? '••••••' : config.type === 'FILE' ? config.filename : config.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-gray-400 py-1">{t('configs.section.projectVariables.empty')}</p>
                        )}
                    </div>

                    {/* Section 2: Test Case Variables (editable) */}
                    <div className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('configs.section.testCaseVariables')}</span>
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
                                            {(['URL', 'VARIABLE', 'SECRET', 'FILE'] as ConfigType[]).map(type => (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => {
                                                        if (type === 'FILE') {
                                                            handleFileUpload();
                                                        } else {
                                                            setEditState({ name: '', value: '', type });
                                                            setError(null);
                                                        }
                                                        setAddTypeOpen(false);
                                                    }}
                                                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                                                >
                                                    {t(`configs.type.${type.toLowerCase()}`)}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="space-y-0.5">
                            {renderConfigsByType(sortedTestCaseConfigs, (config) => {
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
                                                    placeholder={t(`configs.name.placeholder.${config.type.toLowerCase()}`)}
                                                    className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                                <input
                                                    type={config.type === 'SECRET' ? 'password' : 'text'}
                                                    value={editState.value}
                                                    onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                                    placeholder={config.type === 'URL' ? t('configs.url.placeholder') : config.type === 'SECRET' ? t('configs.secret.placeholder') : t('configs.value.placeholder')}
                                                    className="flex-[2] px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                                <button type="button" onClick={handleSave} className="px-2 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90">{t('common.save')}</button>
                                                <button type="button" onClick={() => { setEditState(null); setError(null); }} className="px-2 py-1.5 text-xs text-gray-500">{t('common.cancel')}</button>
                                            </div>
                                            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                                        </div>
                                    );
                                }

                                if (config.type === 'FILE') {
                                    return (
                                        <div key={config.id} className="flex items-center gap-2 px-2 py-1.5 rounded text-sm group hover:bg-gray-50">
                                            <code className="font-mono text-gray-800 text-xs">
                                                {`file_${(config.filename || config.name).replace(/[^a-zA-Z0-9]/g, '_')}`}
                                            </code>
                                            <span className="text-gray-400 text-xs truncate">{config.filename}</span>
                                            {!readOnly && (
                                                <div className="ml-auto flex gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDownload(config)}
                                                        className="p-1 text-gray-400 hover:text-gray-600"
                                                        title={t('common.download')}
                                                    >
                                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
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
                                }

                                return (
                                    <div key={config.id} className="flex items-center gap-2 px-2 py-1.5 rounded text-sm group hover:bg-gray-50">
                                        <code className="font-mono text-gray-800 text-xs">{config.name}</code>
                                        <span className="text-gray-400 text-xs truncate">
                                            {config.type === 'SECRET' ? '••••••' : config.value}
                                        </span>
                                        {overridesProject && (
                                            <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{t('configs.override')}</span>
                                        )}
                                        {!readOnly && (
                                            <div className="ml-auto flex gap-1">
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
                                            placeholder={t(`configs.name.placeholder.${editState.type.toLowerCase()}`)}
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
                                        <button type="button" onClick={handleSave} className="px-2 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90">{t('common.save')}</button>
                                        <button type="button" onClick={() => { setEditState(null); setError(null); }} className="px-2 py-1.5 text-xs text-gray-500">{t('common.cancel')}</button>
                                    </div>
                                    {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                                </div>
                            )}

                            {testCaseConfigs.length === 0 && !editState && (
                                <p className="text-xs text-gray-400 py-1">—</p>
                            )}
                        </div>
                    </div>

                    {/* Section 3: Browser Configuration (builder mode only) */}
                    {mode === 'builder' && (
                        <div className="px-4 py-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('configs.section.browserConfig')}</span>
                            </div>
                            <div className="space-y-3">
                                {browsers.map((browser, index) => {
                                    const colorClass = colors[index % colors.length];
                                    const label = `Browser ${String.fromCharCode('A'.charCodeAt(0) + index)}`;

                                    return (
                                        <div key={browser.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className={`w-2.5 h-2.5 rounded-full ${colorClass}`}></span>
                                                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">{label}</span>
                                                </div>
                                                {browsers.length > 1 && !readOnly && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveBrowser(index)}
                                                        className="text-xs text-gray-400 hover:text-red-500"
                                                    >
                                                        {t('common.remove')}
                                                    </button>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 gap-2">
                                                <div>
                                                    <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.browser.name')}</label>
                                                    <input
                                                        type="text"
                                                        value={browser.config.name || ''}
                                                        onChange={(e) => updateBrowser(index, 'name', e.target.value)}
                                                        placeholder={t('configs.browser.name.placeholder')}
                                                        className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                                        disabled={readOnly}
                                                    />
                                                </div>
                                                <div className="relative">
                                                    <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.browser.url')}</label>
                                                    <div className={`flex mt-0.5 border border-gray-300 rounded bg-white ${readOnly ? '' : 'focus-within:ring-1 focus-within:ring-primary focus-within:border-primary'}`}>
                                                        <input
                                                            type="text"
                                                            value={browser.config.url}
                                                            onChange={(e) => updateBrowser(index, 'url', e.target.value)}
                                                            placeholder={t('configs.browser.url.placeholder')}
                                                            className={`flex-1 px-2 py-1.5 text-xs bg-white focus:outline-none ${urlConfigs.length > 0 && !readOnly ? 'rounded-l' : 'rounded'}`}
                                                            disabled={readOnly}
                                                        />
                                                        {urlConfigs.length > 0 && !readOnly && (
                                                            <div className="relative">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setUrlDropdownOpen(urlDropdownOpen === browser.id ? null : browser.id)}
                                                                    className="px-2 py-1.5 border-l border-gray-300 rounded-r bg-white hover:bg-gray-50 text-gray-500"
                                                                >
                                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                                    </svg>
                                                                </button>
                                                                {urlDropdownOpen === browser.id && (
                                                                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1 min-w-[200px]">
                                                                        {urlConfigs.map(uc => (
                                                                            <button
                                                                                key={uc.id}
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    updateBrowser(index, 'url', uc.value);
                                                                                    setUrlDropdownOpen(null);
                                                                                }}
                                                                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50"
                                                                            >
                                                                                <span className="font-mono font-medium text-gray-700">{uc.name}</span>
                                                                                <span className="text-gray-400 ml-2 truncate">{uc.value}</span>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

                                {!readOnly && (
                                    <button
                                        type="button"
                                        onClick={handleAddBrowser}
                                        className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors text-xs font-medium flex items-center justify-center gap-2"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                        {t('configs.browser.addBrowser')}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

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

            <input ref={fileInputRef} type="file" className="hidden" />
        </div>
    );
}
