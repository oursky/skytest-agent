'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { ConfigItem, BrowserConfig, TargetConfig, AndroidTargetConfig } from '@/types';
import { isGroupableConfigType, normalizeConfigGroup } from '@/lib/test-config/sort';
import { normalizeBrowserConfig, normalizeBrowserViewportDimensions } from '@/lib/test-config/browser-target';
import { normalizeConfigName } from '@/lib/test-config/validation';
import TargetConfigurationsPanel from './ui/TargetConfigurationsPanel';
import ConfigurationVariablesPanel from './ui/ConfigurationVariablesPanel';
import type { BrowserEntry } from './model/types';
import { useAndroidDeviceOptions } from './hooks/useAndroidDeviceOptions';
import type { EditState, FileUploadDraft } from './model/config-types';
import {
    buildAuthHeaders,
    buildConfigDownloadEndpoint,
    buildConfigGroupEndpoint,
    buildConfigItemEndpoint,
    buildConfigsEndpoint,
    buildConfigUploadEndpoint,
    collectConfigGroupOptions,
} from './model/config-utils';

interface ConfigurationsSectionProps {
    projectId?: string;
    teamId?: string;
    projectConfigs: ConfigItem[];
    testCaseConfigs: ConfigItem[];
    testCaseId?: string;
    onTestCaseConfigsChange: (testCaseId?: string) => void;
    onEnsureTestCaseId?: () => Promise<string | null>;
    readOnly?: boolean;
    browsers: BrowserEntry[];
    setBrowsers: (browsers: BrowserEntry[]) => void;
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
    teamId,
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
        teamId,
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

    const urlConfigs = [...projectConfigs, ...testCaseConfigs].filter(c => c.type === 'URL');
    const appIdConfigs = [...projectConfigs, ...testCaseConfigs]
        .filter((config) => config.type === 'APP_ID')
        .sort((a, b) => a.value.localeCompare(b.value) || a.name.localeCompare(b.name));

    return (
        <div className="space-y-6">
        <ConfigurationVariablesPanel
            projectId={projectId}
            readOnly={readOnly}
            projectConfigs={projectConfigs}
            testCaseConfigs={testCaseConfigs}
            testCaseId={testCaseId}
            onEnsureTestCaseId={onEnsureTestCaseId}
            addTypeOpen={addTypeOpen}
            setAddTypeOpen={setAddTypeOpen}
            addTypeRef={addTypeRef}
            editState={editState}
            setEditState={setEditState}
            error={error}
            setError={setError}
            fileUploadDraft={fileUploadDraft}
            setFileUploadDraft={setFileUploadDraft}
            randomStringDropdownOpen={randomStringDropdownOpen}
            setRandomStringDropdownOpen={setRandomStringDropdownOpen}
            randomStringDropdownRefs={randomStringDropdownRefs}
            testCaseGroupOptions={testCaseGroupOptions}
            onSave={() => { void handleSave(); }}
            onDelete={(configId) => { void handleDelete(configId); }}
            onRemoveGroup={(group) => { void handleRemoveGroup(group); }}
            onDownload={(config) => { void handleDownload(config); }}
            onEdit={handleEdit}
            onFileUploadSave={(draft) => { void handleFileUploadSave(draft); }}
            onConfigEditorKeyDown={handleConfigEditorKeyDown}
        />

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
