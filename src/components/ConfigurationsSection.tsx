'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType, BrowserConfig, TargetConfig, AndroidTargetConfig, AndroidDeviceSelector } from '@/types';
import Link from 'next/link';
import { normalizeAndroidTargetConfig } from '@/lib/android-target-config';
import { compareByGroupThenName, isGroupableConfigType, normalizeConfigGroup } from '@/lib/config-sort';
import { normalizeBrowserConfig, normalizeBrowserViewportDimensions } from '@/lib/browser-target';
import GroupSelectInput from './GroupSelectInput';

const CONFIG_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;

const TYPE_ORDER: ConfigType[] = ['URL', 'APP_ID', 'VARIABLE', 'FILE', 'RANDOM_STRING'];
const ADDABLE_TEST_CASE_CONFIG_TYPES: ConfigType[] = ['URL', 'APP_ID', 'VARIABLE', 'RANDOM_STRING', 'FILE'];

const RANDOM_STRING_GENERATION_TYPES = ['TIMESTAMP_DATETIME', 'TIMESTAMP_UNIX', 'UUID'] as const;

interface BrowserEntry {
    id: string;
    config: BrowserConfig | TargetConfig;
}

interface DeviceInventoryResponse {
    devices: Array<{
        id: string;
        kind: 'emulator' | 'physical';
        serial: string;
        emulatorProfileName?: string;
        state: 'STARTING' | 'BOOTING' | 'IDLE' | 'ACQUIRED' | 'CLEANING' | 'STOPPING' | 'DEAD';
        runProjectId?: string;
    }>;
    connectedDevices: Array<{
        serial: string;
        adbState: 'device' | 'offline' | 'unauthorized' | 'unknown';
        kind: 'emulator' | 'physical';
        manufacturer: string | null;
        model: string | null;
        androidVersion: string | null;
        apiLevel: number | null;
        emulatorProfileName: string | null;
    }>;
    emulatorProfiles: Array<{
        id: string;
        name: string;
        displayName: string;
        apiLevel: number | null;
    }>;
}

interface AndroidDeviceOption {
    id: string;
    selector: AndroidDeviceSelector;
    label: string;
    detail: string;
    statusKey: string;
    statusColorClass: string;
    disabled?: boolean;
    group: 'physical' | 'emulator';
}

const DEVICE_STATE_PRIORITY: Record<DeviceInventoryResponse['devices'][number]['state'], number> = {
    ACQUIRED: 0,
    CLEANING: 1,
    IDLE: 2,
    BOOTING: 3,
    STARTING: 4,
    STOPPING: 5,
    DEAD: 6,
};

const ADB_STATE_PRIORITY: Record<DeviceInventoryResponse['connectedDevices'][number]['adbState'], number> = {
    device: 0,
    unauthorized: 1,
    offline: 2,
    unknown: 3,
};

function buildAndroidDeviceOptionLabel(option: DeviceInventoryResponse['connectedDevices'][number]): string {
    if (option.kind === 'emulator') {
        return option.emulatorProfileName || option.model || option.serial;
    }
    return [option.manufacturer, option.model].filter(Boolean).join(' ').trim() || option.serial;
}

function joinAndroidDeviceDetail(parts: Array<string | null | undefined>): string {
    return parts.filter((part): part is string => Boolean(part && part.trim())).join(', ');
}

function buildAndroidVersionDetail(androidVersion: string | null | undefined, apiLevel: number | null | undefined): string {
    return joinAndroidDeviceDetail([
        androidVersion ? `Android ${androidVersion}` : null,
        apiLevel !== null && apiLevel !== undefined ? `API ${apiLevel}` : null,
    ]);
}

function buildAndroidDeviceOptionDetail(option: DeviceInventoryResponse['connectedDevices'][number]): string {
    return joinAndroidDeviceDetail([option.serial, buildAndroidVersionDetail(option.androidVersion, option.apiLevel)]) || option.serial;
}

function getInventoryOnlyStatusKey(option: DeviceInventoryResponse['connectedDevices'][number]): string {
    if (option.adbState === 'device') return 'device.state.idle';
    if (option.adbState === 'unauthorized') return 'device.adb.unauthorized';
    if (option.adbState === 'offline') return 'device.adb.offline';
    return 'device.adb.unknown';
}

function getInventoryOnlyStatusColorClass(option: DeviceInventoryResponse['connectedDevices'][number]): string {
    if (option.adbState === 'device') return 'bg-green-100 text-green-700';
    if (option.adbState === 'unauthorized') return 'bg-amber-100 text-amber-700';
    return 'bg-gray-100 text-gray-600';
}

function normalizeDeviceName(name: string): string {
    return name.trim().toLowerCase();
}

function isRuntimeInUseByCurrentProject(
    runtime: DeviceInventoryResponse['devices'][number],
    projectId?: string
): boolean {
    return runtime.state === 'ACQUIRED' && Boolean(projectId && runtime.runProjectId === projectId);
}

function getRuntimeStatusKey(
    runtime: DeviceInventoryResponse['devices'][number],
    projectId?: string
): string {
    if (runtime.state === 'ACQUIRED') {
        return isRuntimeInUseByCurrentProject(runtime, projectId)
            ? 'device.inUseCurrentProject'
            : 'device.inUseOtherProject';
    }

    if (runtime.state === 'STARTING') return 'device.state.starting';
    if (runtime.state === 'BOOTING') return 'device.state.booting';
    if (runtime.state === 'IDLE') return 'device.state.idle';
    if (runtime.state === 'CLEANING') return 'device.state.cleaning';
    if (runtime.state === 'STOPPING') return 'device.state.stopping';
    return 'device.state.dead';
}

function getRuntimeStatusColorClass(runtime: DeviceInventoryResponse['devices'][number]): string {
    if (runtime.state === 'STARTING') return 'bg-blue-100 text-blue-700';
    if (runtime.state === 'BOOTING') return 'bg-blue-100 text-blue-700';
    if (runtime.state === 'IDLE') return 'bg-green-100 text-green-700';
    if (runtime.state === 'ACQUIRED') return 'bg-amber-100 text-amber-700';
    if (runtime.state === 'CLEANING') return 'bg-yellow-100 text-yellow-700';
    if (runtime.state === 'STOPPING') return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-600';
}

function isAndroidConfig(config: BrowserConfig | TargetConfig): config is AndroidTargetConfig {
    return 'type' in config && config.type === 'android';
}

function isSameAndroidDeviceSelector(a: AndroidDeviceSelector, b: AndroidDeviceSelector): boolean {
    if (a.mode !== b.mode) {
        return false;
    }
    if (a.mode === 'connected-device') {
        return b.mode === 'connected-device' && a.serial === b.serial;
    }
    return b.mode === 'emulator-profile' && a.emulatorProfileName === b.emulatorProfileName;
}

function getAndroidDeviceSelectorLabel(selector: AndroidDeviceSelector): string {
    return selector.mode === 'connected-device'
        ? selector.serial
        : selector.emulatorProfileName;
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
    const key = type === 'URL' ? 'configs.title.urls'
        : type === 'APP_ID' ? 'configs.title.appIds'
        : type === 'VARIABLE' ? 'configs.title.variables'
            : type === 'RANDOM_STRING' ? 'configs.title.randomStrings'
                : 'configs.title.files';
    return (
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-2 first:pt-0">
            {t(key)}
        </div>
    );
}

function MaskedIcon({ masked }: { masked: boolean }) {
    if (masked) {
        return (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.477 10.477a3 3 0 004.243 4.243" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6.228 6.228A9.956 9.956 0 002.458 12c1.274 4.057 5.065 7 9.542 7 1.531 0 2.974-.344 4.263-.959" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.878 5.083A9.964 9.964 0 0112 5c4.478 0 8.268 2.943 9.542 7a9.97 9.97 0 01-2.334 4.294" />
            </svg>
        );
    }

    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5s8.268 2.943 9.542 7c-1.274 4.057-5.065 7-9.542 7S3.732 16.057 2.458 12z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
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
    const [fileUploadDraft, setFileUploadDraft] = useState<FileUploadDraft | null>(null);
    const [androidDeviceOptions, setAndroidDeviceOptions] = useState<AndroidDeviceOption[]>([]);
    const [avdDropdownOpen, setAvdDropdownOpen] = useState<string | null>(null);
    const [appDropdownOpen, setAppDropdownOpen] = useState<string | null>(null);
    const addTypeRef = useRef<HTMLDivElement>(null);
    const urlDropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const randomStringDropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const avdDropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const appDropdownRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const testCaseGroupOptions = useMemo(() => {
        const groups = new Set<string>();
        for (const config of testCaseConfigs) {
            if (!isGroupableConfigType(config.type)) continue;
            const group = normalizeConfigGroup(config.group);
            if (group) {
                groups.add(group);
            }
        }
        return [...groups].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }, [testCaseConfigs]);

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
        if (readOnly || !projectId) return;
        const fetchDeviceInventory = async () => {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/devices?projectId=${encodeURIComponent(projectId)}`, { headers });
            if (res.ok) {
                const payload = await res.json() as DeviceInventoryResponse;

                const runtimeBySerial = new Map<string, DeviceInventoryResponse['devices'][number]>();
                const runtimeByEmulatorProfile = new Map<string, DeviceInventoryResponse['devices'][number]>();
                for (const runtime of payload.devices) {
                    runtimeBySerial.set(runtime.serial, runtime);
                    if (runtime.kind === 'emulator' && runtime.emulatorProfileName) {
                        const key = normalizeDeviceName(runtime.emulatorProfileName);
                        const existing = runtimeByEmulatorProfile.get(key);
                        if (!existing || DEVICE_STATE_PRIORITY[runtime.state] < DEVICE_STATE_PRIORITY[existing.state]) {
                            runtimeByEmulatorProfile.set(key, runtime);
                        }
                    }
                }

                const connectedPhysicalDevices = payload.connectedDevices.filter((device) => device.kind === 'physical');
                const physicalOptions: AndroidDeviceOption[] = connectedPhysicalDevices.map((device) => {
                    const runtime = runtimeBySerial.get(device.serial);
                    return {
                        id: `physical:${device.serial}`,
                        selector: { mode: 'connected-device', serial: device.serial },
                        label: buildAndroidDeviceOptionLabel(device),
                        detail: buildAndroidDeviceOptionDetail(device),
                        statusKey: runtime ? getRuntimeStatusKey(runtime, projectId) : getInventoryOnlyStatusKey(device),
                        statusColorClass: runtime ? getRuntimeStatusColorClass(runtime) : getInventoryOnlyStatusColorClass(device),
                        disabled: device.adbState !== 'device',
                        group: 'physical',
                    };
                });

                const connectedEmulatorsBySerial = new Map<string, DeviceInventoryResponse['connectedDevices'][number]>();
                const connectedEmulatorsByProfile = new Map<string, DeviceInventoryResponse['connectedDevices'][number]>();
                for (const connected of payload.connectedDevices) {
                    if (connected.kind !== 'emulator') continue;
                    connectedEmulatorsBySerial.set(connected.serial, connected);
                    if (!connected.emulatorProfileName) continue;
                    const key = normalizeDeviceName(connected.emulatorProfileName);
                    const existing = connectedEmulatorsByProfile.get(key);
                    if (!existing || ADB_STATE_PRIORITY[connected.adbState] < ADB_STATE_PRIORITY[existing.adbState]) {
                        connectedEmulatorsByProfile.set(key, connected);
                    }
                }

                const emulatorOptions: AndroidDeviceOption[] = [];
                const usedConnectedEmulatorSerials = new Set<string>();
                const usedRuntimeIds = new Set<string>();

                for (const profile of payload.emulatorProfiles) {
                    const profileKey = normalizeDeviceName(profile.name);
                    const runtime = runtimeByEmulatorProfile.get(profileKey);
                    if (runtime) {
                        usedRuntimeIds.add(runtime.id);
                    }

                    const connected = runtime
                        ? connectedEmulatorsBySerial.get(runtime.serial)
                        : connectedEmulatorsByProfile.get(profileKey);
                    if (connected) {
                        usedConnectedEmulatorSerials.add(connected.serial);
                    }

                    emulatorOptions.push({
                        id: `emulator-profile:${profile.name}`,
                        selector: { mode: 'emulator-profile', emulatorProfileName: profile.name },
                        label: profile.displayName || profile.name,
                        detail: joinAndroidDeviceDetail([
                            connected?.serial ?? runtime?.serial,
                            buildAndroidVersionDetail(connected?.androidVersion, connected?.apiLevel ?? profile.apiLevel),
                        ]) || (profile.apiLevel !== null ? `API ${profile.apiLevel}` : profile.name),
                        statusKey: runtime
                            ? getRuntimeStatusKey(runtime, projectId)
                            : connected
                                ? getInventoryOnlyStatusKey(connected)
                                : 'device.notRunning',
                        statusColorClass: runtime
                            ? getRuntimeStatusColorClass(runtime)
                            : connected
                                ? getInventoryOnlyStatusColorClass(connected)
                                : 'bg-gray-100 text-gray-600',
                        group: 'emulator',
                    });
                }

                for (const connected of payload.connectedDevices) {
                    if (connected.kind !== 'emulator' || usedConnectedEmulatorSerials.has(connected.serial)) {
                        continue;
                    }
                    if (!connected.emulatorProfileName) {
                        continue;
                    }
                    const runtime = runtimeBySerial.get(connected.serial);
                    if (runtime) {
                        usedRuntimeIds.add(runtime.id);
                    }
                    emulatorOptions.push({
                        id: `emulator-connected:${connected.serial}`,
                        selector: { mode: 'connected-device', serial: connected.serial },
                        label: buildAndroidDeviceOptionLabel(connected),
                        detail: buildAndroidDeviceOptionDetail(connected),
                        statusKey: runtime ? getRuntimeStatusKey(runtime, projectId) : getInventoryOnlyStatusKey(connected),
                        statusColorClass: runtime ? getRuntimeStatusColorClass(runtime) : getInventoryOnlyStatusColorClass(connected),
                        disabled: connected.adbState !== 'device',
                        group: 'emulator',
                    });
                }

                for (const runtime of payload.devices) {
                    if (runtime.kind !== 'emulator' || usedRuntimeIds.has(runtime.id)) {
                        continue;
                    }
                    emulatorOptions.push({
                        id: `emulator-runtime:${runtime.id}`,
                        selector: runtime.emulatorProfileName
                            ? { mode: 'emulator-profile', emulatorProfileName: runtime.emulatorProfileName }
                            : { mode: 'connected-device', serial: runtime.serial },
                        label: runtime.emulatorProfileName || runtime.serial,
                        detail: runtime.serial,
                        statusKey: getRuntimeStatusKey(runtime, projectId),
                        statusColorClass: getRuntimeStatusColorClass(runtime),
                        group: 'emulator',
                    });
                }

                setAndroidDeviceOptions([...physicalOptions, ...emulatorOptions]);
            }
        };
        void fetchDeviceInventory().catch(() => {});
    }, [projectId, getAccessToken, readOnly]);

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

        const normalizedName = editState.name.trim().toUpperCase();

        if (!normalizedName) {
            setError(t('configs.error.nameRequired'));
            return;
        }
        if (!CONFIG_NAME_REGEX.test(normalizedName)) {
            setError(t('configs.error.invalidName'));
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
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            };

            if (editState.id) {
                const res = await fetch(`/api/test-cases/${targetTestCaseId}/configs/${editState.id}`, {
                    method: 'PUT',
                    headers,
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
                const res = await fetch(`/api/test-cases/${targetTestCaseId}/configs`, {
                    method: 'POST',
                    headers,
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

    const handleRemoveGroup = useCallback(async (group: string) => {
        const normalizedGroup = normalizeConfigGroup(group);
        if (!normalizedGroup) return;

        try {
            const targetTestCaseId = await resolveTestCaseId();
            if (!targetTestCaseId) return;
            const token = await getAccessToken();
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            };
            const response = await fetch(`/api/test-cases/${targetTestCaseId}/configs/groups`, {
                method: 'DELETE',
                headers,
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
        formData.append('group', normalizeConfigGroup(draft.group));

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
        const nextChar = String.fromCharCode('a'.charCodeAt(0) + browsers.length);
        const newId = `browser_${nextChar}`;
        setBrowsers([...browsers, { id: newId, config: normalizeBrowserConfig({ url: '' }) }]);
    };

    const handleAddAndroid = () => {
        const nextChar = String.fromCharCode('a'.charCodeAt(0) + browsers.length);
        const newId = `android_${nextChar}`;
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

    const colors = ['bg-blue-500', 'bg-purple-500', 'bg-orange-500', 'bg-green-500', 'bg-pink-500'];

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
                                                <input
                                                    type="text"
                                                    value={editState.name}
                                                    onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                                                    onKeyDown={handleConfigEditorKeyDown}
                                                    placeholder={t('configs.name.placeholder.enter')}
                                                    className="h-8 w-full px-2 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                                <GroupSelectInput
                                                    value={editState.group}
                                                    onChange={(group) => setEditState({ ...editState, group })}
                                                    options={testCaseGroupOptions}
                                                    onRemoveOption={handleRemoveGroup}
                                                    placeholder={t('configs.group.select')}
                                                    inputClassName="h-8"
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
                                        <input
                                            type="text"
                                            value={editState.name}
                                            onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                                            onKeyDown={handleConfigEditorKeyDown}
                                            placeholder={t('configs.name.placeholder.enter')}
                                            className="h-8 w-full px-2 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                            autoFocus
                                        />
                                        <GroupSelectInput
                                            value={editState.group}
                                            onChange={(group) => setEditState({ ...editState, group })}
                                            options={testCaseGroupOptions}
                                            onRemoveOption={handleRemoveGroup}
                                            placeholder={t('configs.group.select')}
                                            inputClassName="h-8"
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

        <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">{t('configs.section.browserConfig')}</label>
            <div className="border border-gray-200 rounded-lg bg-white">
                <div className="px-4 py-3">
                    <div className="space-y-3">
                    {browsers.map((browser, index) => {
                        const colorClass = colors[index % colors.length];
                        const android = isAndroidConfig(browser.config);
                        const defaultLabel = android
                            ? `Android ${String.fromCharCode('A'.charCodeAt(0) + index)}`
                            : `Browser ${String.fromCharCode('A'.charCodeAt(0) + index)}`;

                        if (android) {
                            const cfg = browser.config as AndroidTargetConfig;
                            const normalizedAndroidConfig = normalizeAndroidTargetConfig(cfg);
                            const selectedDeviceOption = androidDeviceOptions.find((option) =>
                                isSameAndroidDeviceSelector(option.selector, normalizedAndroidConfig.deviceSelector)
                            );
                            const selectedDeviceLabel = selectedDeviceOption?.label || getAndroidDeviceSelectorLabel(normalizedAndroidConfig.deviceSelector);
                            const physicalDeviceOptions = androidDeviceOptions.filter((option) => option.group === 'physical');
                            const emulatorDeviceOptions = androidDeviceOptions.filter((option) => option.group === 'emulator');
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
                                            <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.android.device')}</label>
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
                                                    <span className={selectedDeviceLabel ? 'text-gray-800' : 'text-gray-400'}>
                                                        {selectedDeviceLabel || t('configs.android.device.placeholder')}
                                                    </span>
                                                    <svg className="w-3 h-3 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                    </svg>
                                                </button>
                                                {avdDropdownOpen === browser.id && !readOnly && (
                                                    <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1 min-w-full max-h-80 overflow-y-auto">
                                                        {androidDeviceOptions.length === 0 ? (
                                                            <div className="px-3 py-2 text-xs text-gray-400">{t('configs.android.device.none')}</div>
                                                        ) : (
                                                            <>
                                                                {physicalDeviceOptions.length > 0 && (
                                                                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                                                                        {t('device.section.connected')}
                                                                    </div>
                                                                )}
                                                                {physicalDeviceOptions.map((option) => (
                                                                    <button
                                                                        key={option.id}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            if (option.disabled) return;
                                                                            updateTarget(index, { deviceSelector: option.selector });
                                                                            setAvdDropdownOpen(null);
                                                                        }}
                                                                        disabled={option.disabled}
                                                                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50 ${selectedDeviceOption && isSameAndroidDeviceSelector(selectedDeviceOption.selector, option.selector) ? 'bg-gray-50 font-medium' : 'text-gray-700'}`}
                                                                    >
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <div className="min-w-0">
                                                                                <div className="truncate">{option.label}</div>
                                                                                <div className="text-[10px] text-gray-400 truncate">{option.detail}</div>
                                                                            </div>
                                                                            <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${option.statusColorClass}`}>
                                                                                {t(option.statusKey)}
                                                                            </span>
                                                                        </div>
                                                                    </button>
                                                                ))}
                                                                {emulatorDeviceOptions.length > 0 && (
                                                                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                                                                        {t('device.section.profiles')}
                                                                    </div>
                                                                )}
                                                                {emulatorDeviceOptions.map((option) => (
                                                                    <button
                                                                        key={option.id}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            updateTarget(index, { deviceSelector: option.selector });
                                                                            setAvdDropdownOpen(null);
                                                                        }}
                                                                        disabled={option.disabled}
                                                                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50 ${selectedDeviceOption && isSameAndroidDeviceSelector(selectedDeviceOption.selector, option.selector) ? 'bg-gray-50 font-medium' : 'text-gray-700'}`}
                                                                    >
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <div className="min-w-0">
                                                                                <div className="truncate">{option.label}</div>
                                                                                <div className="text-[10px] text-gray-400 truncate">{option.detail}</div>
                                                                            </div>
                                                                            <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${option.statusColorClass}`}>
                                                                                {t(option.statusKey)}
                                                                            </span>
                                                                        </div>
                                                                    </button>
                                                                ))}
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-medium text-gray-500 uppercase">
                                                {t('configs.android.appId')} {!readOnly && <span className="text-red-500">*</span>}
                                            </label>
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

                        const cfg = normalizeBrowserConfig(browser.config as BrowserConfig);
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
                                        <label className="text-[10px] font-medium text-gray-500 uppercase">
                                            {t('configs.browser.url')} {!readOnly && <span className="text-red-500">*</span>}
                                        </label>
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
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.browser.width')}</label>
                                            <input
                                                type="number"
                                                min={1}
                                                value={cfg.width}
                                                onChange={(e) => {
                                                    const width = Number.parseInt(e.target.value, 10);
                                                    if (Number.isFinite(width) && width > 0) {
                                                        updateTarget(index, { width });
                                                    }
                                                }}
                                                className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                                disabled={readOnly}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.browser.height')}</label>
                                            <input
                                                type="number"
                                                min={1}
                                                value={cfg.height}
                                                onChange={(e) => {
                                                    const height = Number.parseInt(e.target.value, 10);
                                                    if (Number.isFinite(height) && height > 0) {
                                                        updateTarget(index, { height });
                                                    }
                                                }}
                                                className="w-full mt-0.5 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                                disabled={readOnly}
                                            />
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
                            {projectId && androidDeviceOptions.length > 0 && (
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

            </div>
        </div>
        </div>
    );
}
