'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType, BrowserConfig, TargetConfig, AndroidTargetConfig } from '@/types';
import Link from 'next/link';

const CONFIG_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;

const TYPE_ORDER: ConfigType[] = ['URL', 'APP_ID', 'VARIABLE', 'SECRET', 'FILE', 'RANDOM_STRING'];
const ADDABLE_TEST_CASE_CONFIG_TYPES: ConfigType[] = ['URL', 'APP_ID', 'VARIABLE', 'SECRET', 'FILE', 'RANDOM_STRING'];

const RANDOM_STRING_GENERATION_TYPES = ['TIMESTAMP_DATETIME', 'TIMESTAMP_UNIX', 'UUID'] as const;

interface BrowserEntry {
    id: string;
    config: BrowserConfig | TargetConfig;
}

interface AvdProfile {
    id: string;
    name: string;
    displayName: string;
    apiLevel: number | null;
}

function isAndroidConfig(config: BrowserConfig | TargetConfig): config is AndroidTargetConfig {
    return 'type' in config && config.type === 'android';
}

function isEmptyEntryPoint(config: BrowserConfig | TargetConfig): boolean {
    if (isAndroidConfig(config)) {
        return !config.name?.trim() && !config.avdName?.trim() && !config.appId?.trim();
    }

    return !config.name?.trim() && !config.url?.trim();
}

interface ConfigurationsSectionProps {
    projectId?: string;
    projectConfigs: ConfigItem[];
    testCaseConfigs: ConfigItem[];
    testCaseId?: string;
    onTestCaseConfigsChange: (testCaseId?: string) => void;
    onEnsureTestCaseId?: () => Promise<string | null>;
    readOnly?: boolean;
    browsers: BrowserEntry[];
    setBrowsers: (browsers: BrowserEntry[]) => void;
}

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

function sortConfigs(configs: ConfigItem[]): ConfigItem[] {
    return [...configs].sort((a, b) => {
        const typeA = TYPE_ORDER.indexOf(a.type);
        const typeB = TYPE_ORDER.indexOf(b.type);
        if (typeA !== typeB) return typeA - typeB;
        return a.name.localeCompare(b.name);
    });
}

function randomStringGenerationLabel(value: string, t: (key: string) => string): string {
    switch (value) {
        case 'TIMESTAMP_UNIX': return t('configs.randomString.timestampUnix');
        case 'TIMESTAMP_DATETIME': return t('configs.randomString.timestampDatetime');
        case 'UUID': return t('configs.randomString.uuid');
        default: return value;
    }
}

function TypeSubHeader({ type, t }: { type: ConfigType; t: (key: string) => string }) {
    const key = type === 'URL' ? 'configs.title.urls'
        : type === 'APP_ID' ? 'configs.title.appIds'
        : type === 'VARIABLE' ? 'configs.title.variables'
            : type === 'SECRET' ? 'configs.title.secrets'
                : type === 'RANDOM_STRING' ? 'configs.title.randomStrings'
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
    onEnsureTestCaseId,
    readOnly,
    browsers,
    setBrowsers,
}: ConfigurationsSectionProps) {
    const { getAccessToken } = useAuth();
    const { t } = useI18n();
    const [editState, setEditState] = useState<EditState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [addTypeOpen, setAddTypeOpen] = useState(false);
    const [urlDropdownOpen, setUrlDropdownOpen] = useState<string | null>(null);
    const [randomStringDropdownOpen, setRandomStringDropdownOpen] = useState<string | null>(null);
    const [showSecretInEdit, setShowSecretInEdit] = useState(false);
    const [fileUploadDraft, setFileUploadDraft] = useState<FileUploadDraft | null>(null);
    const [avdProfiles, setAvdProfiles] = useState<AvdProfile[]>([]);
    const [avdDropdownOpen, setAvdDropdownOpen] = useState<string | null>(null);
    const [appDropdownOpen, setAppDropdownOpen] = useState<string | null>(null);
    const addTypeRef = useRef<HTMLDivElement>(null);
    const urlDropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const randomStringDropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const avdDropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const appDropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    useEffect(() => {
        if (!addTypeOpen && !urlDropdownOpen && !randomStringDropdownOpen && !avdDropdownOpen && !appDropdownOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (addTypeOpen && addTypeRef.current && !addTypeRef.current.contains(e.target as Node)) {
                setAddTypeOpen(false);
            }
            if (urlDropdownOpen) {
                const ref = urlDropdownRefs.current.get(urlDropdownOpen);
                if (ref && !ref.contains(e.target as Node)) {
                    setUrlDropdownOpen(null);
                }
            }
            if (randomStringDropdownOpen) {
                const ref = randomStringDropdownRefs.current.get(randomStringDropdownOpen);
                if (ref && !ref.contains(e.target as Node)) {
                    setRandomStringDropdownOpen(null);
                }
            }
            if (avdDropdownOpen) {
                const ref = avdDropdownRefs.current.get(avdDropdownOpen);
                if (ref && !ref.contains(e.target as Node)) {
                    setAvdDropdownOpen(null);
                }
            }
            if (appDropdownOpen) {
                const ref = appDropdownRefs.current.get(appDropdownOpen);
                if (ref && !ref.contains(e.target as Node)) {
                    setAppDropdownOpen(null);
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [addTypeOpen, urlDropdownOpen, randomStringDropdownOpen, avdDropdownOpen, appDropdownOpen]);

    useEffect(() => {
        if (!projectId) return;
        const fetchAvdProfiles = async () => {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const avdRes = await fetch(`/api/projects/${projectId}/avd-profiles`, { headers });
            if (avdRes.ok) {
                setAvdProfiles(await avdRes.json() as AvdProfile[]);
            }
        };
        void fetchAvdProfiles().catch(() => {});
    }, [projectId, getAccessToken]);

    const resolveTestCaseId = useCallback(async () => {
        if (testCaseId) {
            return testCaseId;
        }
        if (onEnsureTestCaseId) {
            return await onEnsureTestCaseId();
        }
        return null;
    }, [testCaseId, onEnsureTestCaseId]);

    const handleSave = useCallback(async () => {
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
        if (editState.type !== 'FILE' && editState.type !== 'RANDOM_STRING' && !editState.value.trim()) {
            setError(t('configs.error.valueRequired'));
            return;
        }

        try {
            const targetTestCaseId = await resolveTestCaseId();
            if (!targetTestCaseId) {
                setError('Failed to save');
                return;
            }
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            };

            if (editState.id) {
                const res = await fetch(`/api/test-cases/${targetTestCaseId}/configs/${editState.id}`, {
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
                const res = await fetch(`/api/test-cases/${targetTestCaseId}/configs`, {
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
            setRandomStringDropdownOpen(null);
            onTestCaseConfigsChange(targetTestCaseId);
        } catch (err) {
            console.error('Failed to save config', err);
            setError('Failed to save');
        }
    }, [editState, resolveTestCaseId, getAccessToken, onTestCaseConfigsChange, t]);

    const handleDelete = useCallback(async (configId: string) => {
        try {
            const targetTestCaseId = await resolveTestCaseId();
            if (!targetTestCaseId) return;
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            await fetch(`/api/test-cases/${targetTestCaseId}/configs/${configId}`, {
                method: 'DELETE',
                headers,
            });
            onTestCaseConfigsChange(targetTestCaseId);
        } catch (err) {
            console.error('Failed to delete config', err);
        }
    }, [resolveTestCaseId, getAccessToken, onTestCaseConfigsChange]);

    const handleFileUploadSave = useCallback(async (draft: FileUploadDraft | null = fileUploadDraft) => {
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

        const duplicate = testCaseConfigs.find((config) => config.name === normalizedName);
        if (duplicate) {
            setError(t('configs.error.nameTaken'));
            return;
        }

        const formData = new FormData();
        formData.append('file', draft.file);
        formData.append('name', normalizedName);

        try {
            const targetTestCaseId = await resolveTestCaseId();
            if (!targetTestCaseId) return;
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/test-cases/${targetTestCaseId}/configs/upload`, {
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
            onTestCaseConfigsChange(targetTestCaseId);
        } catch (err) {
            console.error('Failed to upload file', err);
        }
    }, [fileUploadDraft, testCaseConfigs, resolveTestCaseId, getAccessToken, onTestCaseConfigsChange, t]);

    const handleConfigEditorKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        void handleSave();
    }, [handleSave]);

    const renderRandomStringDropdown = (dropdownKey: string, value: string) => (
        <div
            className="relative"
            ref={(el) => {
                if (el) {
                    randomStringDropdownRefs.current.set(dropdownKey, el);
                    return;
                }
                randomStringDropdownRefs.current.delete(dropdownKey);
            }}
        >
            <button
                type="button"
                onClick={() => setRandomStringDropdownOpen(randomStringDropdownOpen === dropdownKey ? null : dropdownKey)}
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded bg-white text-left focus:outline-none focus:ring-1 focus:ring-primary flex items-center justify-between gap-2"
            >
                <span className="truncate">{randomStringGenerationLabel(value, t)}</span>
                <svg className="w-3 h-3 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {randomStringDropdownOpen === dropdownKey && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1 min-w-[180px]">
                    {RANDOM_STRING_GENERATION_TYPES.map((generationType) => (
                        <button
                            key={generationType}
                            type="button"
                            onClick={() => {
                                if (!editState) return;
                                setEditState({ ...editState, value: generationType });
                                setRandomStringDropdownOpen(null);
                            }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${value === generationType ? 'bg-gray-50 text-gray-900' : 'text-gray-700'}`}
                        >
                            {randomStringGenerationLabel(generationType, t)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );

    const handleDownload = useCallback(async (config: ConfigItem) => {
        try {
            const targetTestCaseId = await resolveTestCaseId();
            if (!targetTestCaseId) return;
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/test-cases/${targetTestCaseId}/configs/${config.id}/download`, { headers });
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
    }, [resolveTestCaseId, getAccessToken]);

    const handleEdit = useCallback(async (config: ConfigItem) => {
        if (!testCaseId) return;
        setShowSecretInEdit(false);
        setRandomStringDropdownOpen(null);
        if (config.type === 'SECRET') {
            try {
                const token = await getAccessToken();
                const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
                const res = await fetch(`/api/test-cases/${testCaseId}/configs?includeSecretValues=true`, { headers });
                if (res.ok) {
                    const configsWithSecrets = await res.json();
                    const configWithSecret = configsWithSecrets.find((c: ConfigItem) => c.id === config.id);
                    if (configWithSecret) {
                        setEditState({ id: config.id, name: config.name, value: configWithSecret.value, type: config.type });
                        setError(null);
                        return;
                    }
                }
            } catch (err) {
                console.error('Failed to fetch secret value', err);
            }
        }
        setEditState({ id: config.id, name: config.name, value: config.value, type: config.type });
        setError(null);
    }, [testCaseId, getAccessToken]);

    const handleAddBrowser = () => {
        const nextChar = String.fromCharCode('a'.charCodeAt(0) + browsers.length);
        const newId = `browser_${nextChar}`;
        setBrowsers([...browsers, { id: newId, config: { url: '' } }]);
    };

    const handleAddAndroid = () => {
        const nextChar = String.fromCharCode('a'.charCodeAt(0) + browsers.length);
        const newId = `android_${nextChar}`;
        setBrowsers([...browsers, {
            id: newId,
            config: {
                type: 'android' as const,
                name: '',
                avdName: '',
                appId: '',
                clearAppState: true,
                allowAllPermissions: true,
            }
        }]);
    };

    const handleRemoveBrowser = (index: number) => {
        if (browsers.length <= 1) return;
        const newBrowsers = [...browsers];
        newBrowsers.splice(index, 1);
        setBrowsers(newBrowsers);
    };

    const updateTarget = (index: number, updates: Partial<BrowserConfig & AndroidTargetConfig>) => {
        const newBrowsers = [...browsers];
        newBrowsers[index] = {
            ...newBrowsers[index],
            config: { ...newBrowsers[index].config, ...updates } as BrowserConfig | TargetConfig
        };
        setBrowsers(newBrowsers);
    };

    const overriddenNames = new Set(testCaseConfigs.map(c => c.name));
    const sortedProjectConfigs = sortConfigs(projectConfigs);
    const sortedTestCaseConfigs = sortConfigs(testCaseConfigs);

    const urlConfigs = [...projectConfigs, ...testCaseConfigs].filter(c => c.type === 'URL');
    const appIdConfigs = [...projectConfigs, ...testCaseConfigs]
        .filter((config) => config.type === 'APP_ID')
        .sort((a, b) => a.value.localeCompare(b.value) || a.name.localeCompare(b.name));

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
        <div className="space-y-6">
        <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
            <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('configs.section.projectVariables')}</span>
                    {projectId && (
                        <Link
                            href={`/projects/${projectId}?tab=configs`}
                            className="text-xs text-primary hover:text-primary/80"
                        >
                            {t('configs.manage')} →
                        </Link>
                    )}
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
                                    {config.type === 'SECRET' ? '••••••' : config.type === 'FILE' ? (config.filename || config.value) : config.type === 'RANDOM_STRING' ? randomStringGenerationLabel(config.value, t) : config.value}
                                </span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-gray-400 py-1">{t('configs.section.projectVariables.empty')}</p>
                )}
            </div>

            <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('configs.section.testCaseVariables')}</span>
                    {!readOnly && (testCaseId || onEnsureTestCaseId) && (
                        <div className="relative" ref={addTypeRef}>
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
                                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 py-1 min-w-[150px]">
                                    {ADDABLE_TEST_CASE_CONFIG_TYPES.map(type => (
                                        <button
                                            key={type}
                                            type="button"
                                            onClick={() => {
                                                if (type === 'FILE') {
                                                    setEditState(null);
                                                    setShowSecretInEdit(false);
                                                    setFileUploadDraft({ name: '', file: null });
                                                    setError(null);
                                                    setRandomStringDropdownOpen(null);
                                                } else {
                                                    setFileUploadDraft(null);
                                                    setEditState({ name: '', value: type === 'RANDOM_STRING' ? 'TIMESTAMP_DATETIME' : '', type });
                                                    setError(null);
                                                    setShowSecretInEdit(false);
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
                                            onKeyDown={handleConfigEditorKeyDown}
                                            placeholder={t(`configs.name.placeholder.${config.type.toLowerCase()}`)}
                                            className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                        <div className="flex-[2] relative">
                                            {config.type === 'RANDOM_STRING' ? (
                                                renderRandomStringDropdown(`existing-${config.id}`, editState.value)
                                            ) : (
                                                <>
                                                    <input
                                                        type={config.type === 'SECRET' && !showSecretInEdit ? 'password' : 'text'}
                                                        value={editState.value}
                                                        onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                                        onKeyDown={handleConfigEditorKeyDown}
                                                        placeholder={config.type === 'URL' ? t('configs.url.placeholder') : config.type === 'SECRET' ? t('configs.secret.placeholder') : t('configs.value.placeholder')}
                                                        className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary pr-7"
                                                    />
                                                    {config.type === 'SECRET' && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowSecretInEdit(!showSecretInEdit)}
                                                            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
                                                        >
                                                            {showSecretInEdit ? (
                                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                                </svg>
                                                            ) : (
                                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                        <button type="button" onClick={handleSave} className="px-2 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90">{t('common.save')}</button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setEditState(null);
                                                setError(null);
                                                setRandomStringDropdownOpen(null);
                                            }}
                                            className="px-2 py-1.5 text-xs text-gray-500"
                                        >
                                            {t('common.cancel')}
                                        </button>
                                    </div>
                                    {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                                </div>
                            );
                        }

                        if (config.type === 'FILE') {
                            return (
                                <div key={config.id} className="flex items-center gap-2 px-2 py-1.5 rounded text-sm group hover:bg-gray-50">
                                    <code className="font-mono text-gray-800 text-xs">{config.name}</code>
                                    <span className="text-gray-400 text-xs truncate">{config.filename || config.value}</span>
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
                                    {config.type === 'SECRET' ? '••••••' : config.type === 'RANDOM_STRING' ? randomStringGenerationLabel(config.value, t) : config.value}
                                </span>
                                {overridesProject && (
                                    <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{t('configs.override')}</span>
                                )}
                                {!readOnly && (
                                    <div className="ml-auto flex gap-1">
                                        <button
                                            type="button"
                                            onClick={() => handleEdit(config)}
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
                            <div className="flex gap-2 items-center">
                                <input
                                    type="text"
                                    value={editState.name}
                                    onChange={(e) => setEditState({ ...editState, name: e.target.value.toUpperCase() })}
                                    onKeyDown={handleConfigEditorKeyDown}
                                    placeholder={t(`configs.name.placeholder.${editState.type.toLowerCase()}`)}
                                    className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                    autoFocus
                                />
                                <div className="flex-[2] relative">
                                    {editState.type === 'RANDOM_STRING' ? (
                                        renderRandomStringDropdown('new-random-string', editState.value)
                                    ) : (
                                        <>
                                            <input
                                                type={editState.type === 'SECRET' && !showSecretInEdit ? 'password' : 'text'}
                                                value={editState.value}
                                                onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                                onKeyDown={handleConfigEditorKeyDown}
                                                placeholder={editState.type === 'URL' ? t('configs.url.placeholder') : editState.type === 'SECRET' ? t('configs.secret.placeholder') : t('configs.value.placeholder')}
                                                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary pr-7"
                                            />
                                            {editState.type === 'SECRET' && (
                                                <button
                                                    type="button"
                                                    onClick={() => setShowSecretInEdit(!showSecretInEdit)}
                                                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
                                                >
                                                    {showSecretInEdit ? (
                                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                        </svg>
                                                    ) : (
                                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                        </svg>
                                                    )}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                                <button type="button" onClick={handleSave} className="px-2 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90">{t('common.save')}</button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditState(null);
                                        setError(null);
                                        setRandomStringDropdownOpen(null);
                                    }}
                                    className="px-2 py-1.5 text-xs text-gray-500"
                                >
                                    {t('common.cancel')}
                                </button>
                            </div>
                            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                        </div>
                    )}

                    {fileUploadDraft && (
                        <div className="p-2 bg-blue-50/50 rounded">
                            <div className="flex gap-2 items-center">
                                <input
                                    type="text"
                                    value={fileUploadDraft.name}
                                    onChange={(e) => setFileUploadDraft({ ...fileUploadDraft, name: e.target.value.toUpperCase() })}
                                    placeholder={t('configs.name.placeholder.file')}
                                    className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-primary"
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
                                        className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary file:mr-2 file:px-2 file:py-1 file:border-0 file:rounded file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setFileUploadDraft(null);
                                        setError(null);
                                    }}
                                    className="inline-flex items-center px-2 py-1.5 text-xs text-gray-500"
                                >
                                    {t('common.cancel')}
                                </button>
                            </div>
                            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                        </div>
                    )}

                    {testCaseConfigs.length === 0 && !editState && !fileUploadDraft && (
                        <p className="text-xs text-gray-400 py-1">—</p>
                    )}
                </div>
            </div>

        </div>

        <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">{t('configs.section.browserConfig')}</label>
            <div className="border border-gray-200 rounded-lg bg-white">
                <div className="px-4 py-3">
                    <div className="space-y-3">
                    {browsers.map((browser, index) => {
                        if (readOnly && isEmptyEntryPoint(browser.config)) {
                            return null;
                        }

                        const colorClass = colors[index % colors.length];
                        const android = isAndroidConfig(browser.config);
                        const defaultLabel = android
                            ? `Android ${String.fromCharCode('A'.charCodeAt(0) + index)}`
                            : `Browser ${String.fromCharCode('A'.charCodeAt(0) + index)}`;

                        if (android) {
                            const cfg = browser.config as AndroidTargetConfig;
                            const selectedAvd = avdProfiles.find((avd) => avd.name === cfg.avdName);
                            return (
                                <div key={browser.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className={`w-2.5 h-2.5 rounded-full ${colorClass}`}></span>
                                            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">{cfg.name || defaultLabel}</span>
                                        </div>
                                        {browsers.length > 1 && !readOnly && (
                                            <button type="button" onClick={() => handleRemoveBrowser(index)} className="text-xs text-gray-400 hover:text-red-500">
                                                {t('common.remove')}
                                            </button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        <div>
                                            <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.browser.name')}</label>
                                            <input
                                                type="text"
                                                value={cfg.name || ''}
                                                onChange={(e) => updateTarget(index, { name: e.target.value })}
                                                placeholder={t('configs.android.name.placeholder')}
                                                className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                                disabled={readOnly}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.android.avd')}</label>
                                            <div
                                                className="relative mt-0.5"
                                                ref={(el) => {
                                                    if (el) avdDropdownRefs.current.set(browser.id, el);
                                                    else avdDropdownRefs.current.delete(browser.id);
                                                }}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => !readOnly && setAvdDropdownOpen(avdDropdownOpen === browser.id ? null : browser.id)}
                                                    disabled={readOnly}
                                                    className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded bg-white text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-50"
                                                >
                                                    <span className={selectedAvd ? 'text-gray-800' : 'text-gray-400'}>
                                                        {selectedAvd?.displayName || cfg.avdName || t('configs.android.avd.placeholder')}
                                                    </span>
                                                    <svg className="w-3 h-3 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                    </svg>
                                                </button>
                                                {avdDropdownOpen === browser.id && !readOnly && (
                                                    <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1 min-w-full">
                                                        {avdProfiles.length === 0 ? (
                                                            <div className="px-3 py-2 text-xs text-gray-400">{t('configs.android.avd.none')}</div>
                                                        ) : (
                                                            avdProfiles.map((avd) => (
                                                                <button
                                                                    key={avd.id}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        updateTarget(index, { avdName: avd.name });
                                                                        setAvdDropdownOpen(null);
                                                                    }}
                                                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${cfg.avdName === avd.name ? 'bg-gray-50 font-medium' : 'text-gray-700'}`}
                                                                >
                                                                    {avd.displayName}
                                                                </button>
                                                            ))
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.android.appId')}</label>
                                            <div className={`flex mt-0.5 border border-gray-300 rounded bg-white ${readOnly ? '' : 'focus-within:ring-1 focus-within:ring-primary focus-within:border-primary'}`}>
                                                <input
                                                    type="text"
                                                    value={cfg.appId || ''}
                                                    onChange={(e) => updateTarget(index, { appId: e.target.value })}
                                                    placeholder={t('configs.android.appId.placeholder')}
                                                    className={`flex-1 px-2 py-1.5 text-xs bg-white focus:outline-none ${appIdConfigs.length > 0 && !readOnly ? 'rounded-l' : 'rounded'}`}
                                                    disabled={readOnly}
                                                />
                                                {appIdConfigs.length > 0 && !readOnly && (
                                                    <div
                                                        className="relative"
                                                        ref={(el) => {
                                                            if (el) appDropdownRefs.current.set(browser.id, el);
                                                            else appDropdownRefs.current.delete(browser.id);
                                                        }}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => setAppDropdownOpen(appDropdownOpen === browser.id ? null : browser.id)}
                                                            className="h-full px-2 border-l border-gray-300 rounded-r bg-white hover:bg-gray-50 text-gray-500 flex items-center"
                                                        >
                                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                            </svg>
                                                        </button>
                                                        {appDropdownOpen === browser.id && (
                                                            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1 min-w-[220px]">
                                                                {appIdConfigs.map((appConfig) => (
                                                                    <button
                                                                        key={appConfig.id}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            updateTarget(index, { appId: appConfig.value });
                                                                            setAppDropdownOpen(null);
                                                                        }}
                                                                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50"
                                                                    >
                                                                        <span className="font-mono font-medium text-gray-700">{appConfig.name}</span>
                                                                        <span className="text-gray-400 ml-2 truncate">{appConfig.value}</span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="space-y-2 rounded border border-gray-200 bg-white p-2">
                                            <label className="flex items-start gap-2 text-xs text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    checked={cfg.clearAppState}
                                                    onChange={(e) => updateTarget(index, { clearAppState: e.target.checked })}
                                                    disabled={readOnly}
                                                    className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
                                                />
                                                <span>
                                                    <span className="block font-medium">{t('configs.android.clearAppState')}</span>
                                                </span>
                                            </label>
                                            <label className="flex items-start gap-2 text-xs text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    checked={cfg.allowAllPermissions}
                                                    onChange={(e) => updateTarget(index, { allowAllPermissions: e.target.checked })}
                                                    disabled={readOnly}
                                                    className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
                                                />
                                                <span>
                                                    <span className="block font-medium">{t('configs.android.allowAllPermissions')}</span>
                                                </span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        const cfg = browser.config as BrowserConfig;
                        return (
                            <div key={browser.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2.5 h-2.5 rounded-full ${colorClass}`}></span>
                                        <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">{defaultLabel}</span>
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
                                            value={cfg.name || ''}
                                            onChange={(e) => updateTarget(index, { name: e.target.value })}
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
                                                value={cfg.url}
                                                onChange={(e) => updateTarget(index, { url: e.target.value })}
                                                placeholder={t('configs.browser.url.placeholder')}
                                                className={`flex-1 px-2 py-1.5 text-xs bg-white focus:outline-none ${urlConfigs.length > 0 && !readOnly ? 'rounded-l' : 'rounded'}`}
                                                disabled={readOnly}
                                            />
                                            {urlConfigs.length > 0 && !readOnly && (
                                                <div className="relative" ref={(el) => { if (el) urlDropdownRefs.current.set(browser.id, el); }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => setUrlDropdownOpen(urlDropdownOpen === browser.id ? null : browser.id)}
                                                        className="h-full px-2 border-l border-gray-300 rounded-r bg-white hover:bg-gray-50 text-gray-500 flex items-center"
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
                                                                        updateTarget(index, { url: uc.value });
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
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={handleAddBrowser}
                                className="flex-1 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors text-xs font-medium flex items-center justify-center gap-1.5"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                {t('configs.browser.addBrowser')}
                            </button>
                            {projectId && avdProfiles.length > 0 && (
                                <button
                                    type="button"
                                    onClick={handleAddAndroid}
                                    className="flex-1 py-2 border-2 border-dashed border-green-300 rounded-lg text-green-600 hover:border-green-400 hover:text-green-700 transition-colors text-xs font-medium flex items-center justify-center gap-1.5"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    {t('configs.target.addAndroid')}
                                </button>
                            )}
                        </div>
                    )}
                    </div>
                </div>

                {!readOnly && (
                    <div className="px-4 py-2 bg-gray-50 space-y-2 rounded-b-lg border-t border-gray-100">
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
                )}
            </div>
        </div>
        </div>
    );
}
