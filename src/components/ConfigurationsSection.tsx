'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType, BrowserConfig, TargetConfig, AndroidTargetConfig } from '@/types';
import Link from 'next/link';
import { compareByGroupThenName, isGroupableConfigType, normalizeConfigGroup } from '@/lib/config/sort';
import { normalizeBrowserConfig, normalizeBrowserViewportDimensions } from '@/lib/config/browser-target';
import { normalizeConfigName } from '@/lib/config/validation';
import GroupSelectInput from './GroupSelectInput';
import MaskedIcon from './config-shared/MaskedIcon';
import TargetConfigurationsPanel from './configurations-section/TargetConfigurationsPanel';
import type { BrowserEntry } from './configurations-section/types';
import { useAndroidDeviceOptions } from './configurations-section/useAndroidDeviceOptions';
import {
    buildAuthHeaders,
    buildConfigDownloadEndpoint,
    buildConfigGroupEndpoint,
    buildConfigItemEndpoint,
    buildConfigsEndpoint,
    buildConfigUploadEndpoint,
    collectConfigGroupOptions,
    getConfigTypeTitleKey,
} from './config-shared/config-utils';
const TYPE_ORDER: ConfigType[] = ['URL', 'APP_ID', 'VARIABLE', 'FILE', 'RANDOM_STRING'];
const ADDABLE_TEST_CASE_CONFIG_TYPES: ConfigType[] = ['URL', 'APP_ID', 'VARIABLE', 'RANDOM_STRING', 'FILE'];

const RANDOM_STRING_GENERATION_TYPES = ['TIMESTAMP_DATETIME', 'TIMESTAMP_UNIX', 'UUID'] as const;

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
    masked: boolean;
    group: string;
}

interface FileUploadDraft {
    name: string;
    group: string;
    file: File | null;
}

function sortConfigs(configs: ConfigItem[]): ConfigItem[] {
    return [...configs].sort((a, b) => {
        const byGroup = compareByGroupThenName(a, b);
        if (byGroup !== 0) {
            return byGroup;
        }
        const typeA = TYPE_ORDER.indexOf(a.type);
        const typeB = TYPE_ORDER.indexOf(b.type);
        if (typeA !== typeB) return typeA - typeB;
        return 0;
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
    return (
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-2 first:pt-0">
            {t(getConfigTypeTitleKey(type))}
        </div>
    );
}

function getNextTargetId(prefix: 'browser' | 'android', existing: BrowserEntry[]): string {
    const usedIds = new Set(existing.map((entry) => entry.id));
    let index = 0;
    while (index < 1000) {
        const suffix = index < 26
            ? String.fromCharCode('a'.charCodeAt(0) + index)
            : String(index + 1);
        const candidate = `${prefix}_${suffix}`;
        if (!usedIds.has(candidate)) {
            return candidate;
        }
        index += 1;
    }
    return `${prefix}_${Date.now().toString(36)}`;
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
    const [fileUploadDraft, setFileUploadDraft] = useState<FileUploadDraft | null>(null);
    const [avdDropdownOpen, setAvdDropdownOpen] = useState<string | null>(null);
    const [appDropdownOpen, setAppDropdownOpen] = useState<string | null>(null);
    const addTypeRef = useRef<HTMLDivElement>(null);
    const urlDropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const randomStringDropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const avdDropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const appDropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const testCaseGroupOptions = useMemo(() => {
        return collectConfigGroupOptions(testCaseConfigs);
    }, [testCaseConfigs]);

    const androidDeviceOptions = useAndroidDeviceOptions({
        projectId,
        readOnly,
        getAccessToken,
    });

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

        const normalizedName = normalizeConfigName(editState.name);

        if (!normalizedName) {
            setError(t('configs.error.nameRequired'));
            return;
        }
        if (editState.type !== 'FILE' && editState.type !== 'RANDOM_STRING' && !editState.value.trim()) {
            setError(t('configs.error.valueRequired'));
            return;
        }

        const normalizedGroup = isGroupableConfigType(editState.type) ? normalizeConfigGroup(editState.group) : '';
        const normalizedMasked = editState.type === 'VARIABLE' ? editState.masked : false;

        try {
            const targetTestCaseId = await resolveTestCaseId();
            if (!targetTestCaseId) {
                setError('Failed to save');
                return;
            }
            const token = await getAccessToken();

            if (editState.id) {
                const res = await fetch(buildConfigItemEndpoint({ kind: 'test-case', id: targetTestCaseId }, editState.id), {
                    method: 'PUT',
                    headers: buildAuthHeaders(token, true),
                    body: JSON.stringify({
                        name: normalizedName,
                        type: editState.type,
                        value: editState.value,
                        masked: normalizedMasked,
                        group: normalizedGroup || null,
                    }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setError(data.error || 'Failed to update');
                    return;
                }
            } else {
                const res = await fetch(buildConfigsEndpoint({ kind: 'test-case', id: targetTestCaseId }), {
                    method: 'POST',
                    headers: buildAuthHeaders(token, true),
                    body: JSON.stringify({
                        name: normalizedName,
                        type: editState.type,
                        value: editState.value,
                        masked: normalizedMasked,
                        group: normalizedGroup || null,
                    }),
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
            await fetch(buildConfigItemEndpoint({ kind: 'test-case', id: targetTestCaseId }, configId), {
                method: 'DELETE',
                headers: buildAuthHeaders(token),
            });
            onTestCaseConfigsChange(targetTestCaseId);
        } catch (err) {
            console.error('Failed to delete config', err);
        }
    }, [resolveTestCaseId, getAccessToken, onTestCaseConfigsChange]);

    const handleRemoveGroup = useCallback(async (group: string) => {
        const normalizedGroup = normalizeConfigGroup(group);
        if (!normalizedGroup) return;

        try {
            const targetTestCaseId = await resolveTestCaseId();
            if (!targetTestCaseId) return;
            const token = await getAccessToken();
            const response = await fetch(buildConfigGroupEndpoint({ kind: 'test-case', id: targetTestCaseId }), {
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
            onTestCaseConfigsChange(targetTestCaseId);
        } catch (removeError) {
            console.error('Failed to remove group', removeError);
            setError(t('configs.error.removeGroupFailed'));
        }
    }, [resolveTestCaseId, getAccessToken, onTestCaseConfigsChange, t]);

    const handleFileUploadSave = useCallback(async (draft: FileUploadDraft | null = fileUploadDraft) => {
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

        const duplicate = testCaseConfigs.find((config) => config.name === normalizedName);
        if (duplicate) {
            setError(t('configs.error.nameTaken'));
            return;
        }

        const formData = new FormData();
        formData.append('file', draft.file);
        formData.append('name', normalizedName);
        formData.append('group', normalizeConfigGroup(draft.group));

        try {
            const targetTestCaseId = await resolveTestCaseId();
            if (!targetTestCaseId) return;
            const token = await getAccessToken();
            const res = await fetch(buildConfigUploadEndpoint({ kind: 'test-case', id: targetTestCaseId }), {
                method: 'POST',
                headers: buildAuthHeaders(token),
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
            const res = await fetch(
                buildConfigDownloadEndpoint({ kind: 'test-case', id: targetTestCaseId }, config.id),
                { headers: buildAuthHeaders(token) }
            );
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

    const handleEdit = useCallback((config: ConfigItem) => {
        if (!testCaseId) return;
        setRandomStringDropdownOpen(null);
        setEditState({
            id: config.id,
            name: config.name,
            value: config.value,
            type: config.type,
            masked: config.masked === true,
            group: config.group || '',
        });
        setError(null);
    }, [testCaseId]);

    const handleAddBrowser = () => {
        const newId = getNextTargetId('browser', browsers);
        setBrowsers([...browsers, { id: newId, config: normalizeBrowserConfig({ url: '' }) }]);
    };

    const handleAddAndroid = () => {
        const newId = getNextTargetId('android', browsers);
        setBrowsers([...browsers, {
            id: newId,
            config: {
                type: 'android' as const,
                name: '',
                deviceSelector: { mode: 'emulator-profile', emulatorProfileName: '' } as const,
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
        const currentTarget = newBrowsers[index].config;
        if ('type' in currentTarget && currentTarget.type === 'android') {
            newBrowsers[index] = {
                ...newBrowsers[index],
                config: { ...currentTarget, ...updates } as TargetConfig
            };
            setBrowsers(newBrowsers);
            return;
        }

        const currentBrowser = normalizeBrowserConfig(currentTarget as BrowserConfig);
        const mergedBrowser = { ...currentBrowser, ...updates };
        const normalizedDimensions = normalizeBrowserViewportDimensions({
            width: mergedBrowser.width,
            height: mergedBrowser.height,
        });
        newBrowsers[index] = {
            ...newBrowsers[index],
            config: {
                ...mergedBrowser,
                width: normalizedDimensions.width,
                height: normalizedDimensions.height,
            } as BrowserConfig
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

    const renderConfigsByType = (configs: ConfigItem[], renderItem: (config: ConfigItem, type: ConfigType) => React.ReactNode) => {
        let lastType: ConfigType | null = null;
        const elements: React.ReactNode[] = [];
        for (const config of configs) {
            if (config.type !== lastType) {
                elements.push(<TypeSubHeader key={`header-${config.type}-${config.id}`} type={config.type} t={t} />);
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
                    {!readOnly && projectId && (
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
                                    {config.masked ? '••••••' : config.type === 'FILE' ? (config.filename || config.value) : config.type === 'RANDOM_STRING' ? randomStringGenerationLabel(config.value, t) : config.value}
                                </span>
                                {config.group && (
                                    <span className="text-[10px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded uppercase">{config.group}</span>
                                )}
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
                                                    setFileUploadDraft({ name: '', group: '', file: null });
                                                    setError(null);
                                                    setRandomStringDropdownOpen(null);
                                                } else {
                                                    setFileUploadDraft(null);
                                                    setEditState({
                                                        name: '',
                                                        value: type === 'RANDOM_STRING' ? 'TIMESTAMP_DATETIME' : '',
                                                        type,
                                                        masked: false,
                                                        group: '',
                                                    });
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
                                    {config.type === 'VARIABLE' ? (
                                        <>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                <GroupSelectInput
                                                    value={editState.group}
                                                    onChange={(group) => setEditState({ ...editState, group })}
                                                    options={testCaseGroupOptions}
                                                    onRemoveOption={handleRemoveGroup}
                                                    placeholder={t('configs.group.select')}
                                                    inputClassName="h-8"
                                                />
                                                <input
                                                    type="text"
                                                    value={editState.name}
                                                    onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                                                    onKeyDown={handleConfigEditorKeyDown}
                                                    placeholder={t('configs.name.placeholder.enter')}
                                                    className="h-8 w-full px-2 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                            </div>
                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                <input
                                                    type={editState.masked ? 'password' : 'text'}
                                                    value={editState.value}
                                                    onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                                    onKeyDown={handleConfigEditorKeyDown}
                                                    placeholder={t('configs.value.placeholder')}
                                                    className="h-8 min-w-[220px] flex-1 px-2 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setEditState({ ...editState, masked: !editState.masked })}
                                                    className={`inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border ${editState.masked ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-white text-gray-600 border-gray-200'}`}
                                                    title={t('configs.masked')}
                                                    aria-label={t('configs.masked')}
                                                >
                                                    <MaskedIcon masked={editState.masked} />
                                                </button>
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
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex gap-2 items-start">
                                                <input
                                                    type="text"
                                                    value={editState.name}
                                                    onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                                                    onKeyDown={handleConfigEditorKeyDown}
                                                    placeholder={t('configs.name.placeholder.enter')}
                                                    className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                                <div className="flex-[2] relative">
                                                    {config.type === 'RANDOM_STRING' ? (
                                                        renderRandomStringDropdown(`existing-${config.id}`, editState.value)
                                                    ) : (
                                                        <input
                                                            type="text"
                                                            value={editState.value}
                                                            onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                                            onKeyDown={handleConfigEditorKeyDown}
                                                            placeholder={config.type === 'URL' ? t('configs.url.placeholder') : t('configs.value.placeholder')}
                                                            className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                                        />
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
                                            {isGroupableConfigType(config.type) && (
                                                <div className="mt-2">
                                                    <GroupSelectInput
                                                        value={editState.group}
                                                        onChange={(group) => setEditState({ ...editState, group })}
                                                        options={testCaseGroupOptions}
                                                        onRemoveOption={handleRemoveGroup}
                                                        placeholder={t('configs.group.select')}
                                                        inputClassName="h-8"
                                                    />
                                                </div>
                                            )}
                                        </>
                                    )}
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
                                    {config.masked ? '••••••' : config.type === 'RANDOM_STRING' ? randomStringGenerationLabel(config.value, t) : config.value}
                                </span>
                                {config.group && (
                                    <span className="text-[10px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded uppercase">{config.group}</span>
                                )}
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
                            {editState.type === 'VARIABLE' ? (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        <GroupSelectInput
                                            value={editState.group}
                                            onChange={(group) => setEditState({ ...editState, group })}
                                            options={testCaseGroupOptions}
                                            onRemoveOption={handleRemoveGroup}
                                            placeholder={t('configs.group.select')}
                                            inputClassName="h-8"
                                        />
                                        <input
                                            type="text"
                                            value={editState.name}
                                            onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                                            onKeyDown={handleConfigEditorKeyDown}
                                            placeholder={t('configs.name.placeholder.enter')}
                                            className="h-8 w-full px-2 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <input
                                            type={editState.masked ? 'password' : 'text'}
                                            value={editState.value}
                                            onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                            onKeyDown={handleConfigEditorKeyDown}
                                            placeholder={t('configs.value.placeholder')}
                                            className="h-8 min-w-[220px] flex-1 px-2 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setEditState({ ...editState, masked: !editState.masked })}
                                            className={`inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border ${editState.masked ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-white text-gray-600 border-gray-200'}`}
                                            title={t('configs.masked')}
                                            aria-label={t('configs.masked')}
                                        >
                                            <MaskedIcon masked={editState.masked} />
                                        </button>
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
                                </>
                            ) : (
                                <>
                                    <div className="flex gap-2 items-center">
                                        <input
                                            type="text"
                                            value={editState.name}
                                            onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                                            onKeyDown={handleConfigEditorKeyDown}
                                            placeholder={t('configs.name.placeholder.enter')}
                                            className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                            autoFocus
                                        />
                                        <div className="flex-[2] relative">
                                            {editState.type === 'RANDOM_STRING' ? (
                                                renderRandomStringDropdown('new-random-string', editState.value)
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={editState.value}
                                                    onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                                                    onKeyDown={handleConfigEditorKeyDown}
                                                    placeholder={editState.type === 'URL' ? t('configs.url.placeholder') : t('configs.value.placeholder')}
                                                    className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
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
                                    {isGroupableConfigType(editState.type) && (
                                        <div className="mt-2">
                                            <GroupSelectInput
                                                value={editState.group}
                                                onChange={(group) => setEditState({ ...editState, group })}
                                                options={testCaseGroupOptions}
                                                onRemoveOption={handleRemoveGroup}
                                                placeholder={t('configs.group.select')}
                                                inputClassName="h-8"
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                        </div>
                    )}

                    {fileUploadDraft && (
                        <div className="p-2 bg-blue-50/50 rounded">
                            <div className="flex gap-2 items-center">
                                <input
                                    type="text"
                                    value={fileUploadDraft.name}
                                    onChange={(e) => setFileUploadDraft({ ...fileUploadDraft, name: e.target.value })}
                                    placeholder={t('configs.name.placeholder.enter')}
                                    className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
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
                            <div className="mt-2">
                                <GroupSelectInput
                                    value={fileUploadDraft.group}
                                    onChange={(group) => setFileUploadDraft({ ...fileUploadDraft, group })}
                                    options={testCaseGroupOptions}
                                    onRemoveOption={handleRemoveGroup}
                                    placeholder={t('configs.group.select')}
                                    containerClassName="relative w-full"
                                    inputClassName="h-8"
                                />
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

        <TargetConfigurationsPanel
            readOnly={readOnly}
            projectId={projectId}
            browsers={browsers}
            androidDeviceOptions={androidDeviceOptions}
            urlConfigs={urlConfigs}
            appIdConfigs={appIdConfigs}
            urlDropdownOpen={urlDropdownOpen}
            setUrlDropdownOpen={setUrlDropdownOpen}
            avdDropdownOpen={avdDropdownOpen}
            setAvdDropdownOpen={setAvdDropdownOpen}
            appDropdownOpen={appDropdownOpen}
            setAppDropdownOpen={setAppDropdownOpen}
            urlDropdownRefs={urlDropdownRefs}
            avdDropdownRefs={avdDropdownRefs}
            appDropdownRefs={appDropdownRefs}
            onAddBrowser={handleAddBrowser}
            onAddAndroid={handleAddAndroid}
            onRemoveBrowser={handleRemoveBrowser}
            onUpdateTarget={updateTarget}
        />
        </div>
    );
}
