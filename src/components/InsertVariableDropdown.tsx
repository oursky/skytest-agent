'use client';

import { useState, useRef, useEffect } from 'react';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType, TestCaseFile } from '@/types';
import { compareByGroupThenName, normalizeConfigGroup } from '@/lib/config-sort';

interface InsertVariableDropdownProps {
    projectConfigs: ConfigItem[];
    testCaseConfigs: ConfigItem[];
    onInsert: (ref: string) => void;
    allowedTypes?: ConfigType[];
    formatRef?: (config: ConfigItem) => string;
    testFiles?: TestCaseFile[];
    formatTestFileRef?: (file: TestCaseFile) => string;
    onInsertTestFile?: (file: TestCaseFile) => void;
}

interface ConfigGroup {
    key: string;
    label: string;
    configs: DropdownConfigItem[];
}

interface DropdownConfigItem extends ConfigItem {
    source: 'project' | 'test-case';
}

const TYPE_SHORT_LABEL: Record<Exclude<ConfigType, 'APP_ID'>, string> = {
    VARIABLE: 'VAR',
    FILE: 'FIL',
    RANDOM_STRING: 'STR',
    URL: 'URL',
};

function getPreviewValue(config: ConfigItem): string {
    const rawValue = config.type === 'FILE' ? (config.filename || config.value) : config.value;
    if (config.masked) {
        return '••••••';
    }
    if (rawValue.length <= 32) {
        return rawValue;
    }
    return `${rawValue.slice(0, 32)}…`;
}

function groupConfigs(configs: DropdownConfigItem[]): ConfigGroup[] {
    const sorted = [...configs].sort(compareByGroupThenName);
    const grouped = new Map<string, DropdownConfigItem[]>();

    for (const config of sorted) {
        const normalizedGroup = normalizeConfigGroup(config.group);
        const key = normalizedGroup || '__ungrouped__';
        const current = grouped.get(key) || [];
        current.push(config);
        grouped.set(key, current);
    }

    const ungrouped = grouped.get('__ungrouped__') || [];
    const groupedKeys = [...grouped.keys()]
        .filter((key) => key !== '__ungrouped__')
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const result: ConfigGroup[] = [];
    if (ungrouped.length > 0) {
        result.push({ key: '__ungrouped__', label: '', configs: ungrouped });
    }
    for (const key of groupedKeys) {
        result.push({ key, label: key, configs: grouped.get(key) || [] });
    }
    return result;
}

export default function InsertVariableDropdown({
    projectConfigs,
    testCaseConfigs,
    onInsert,
    allowedTypes,
    formatRef,
    testFiles,
    formatTestFileRef,
    onInsertTestFile,
}: InsertVariableDropdownProps) {
    const { t } = useI18n();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [menuAlignment, setMenuAlignment] = useState<'left' | 'right'>('left');

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        const updateMenuAlignment = () => {
            const triggerRect = dropdownRef.current?.getBoundingClientRect();
            const menuRect = menuRef.current?.getBoundingClientRect();
            if (!triggerRect || !menuRect) return;

            const viewportPadding = 8;
            const wouldOverflowRight = triggerRect.left + menuRect.width > window.innerWidth - viewportPadding;
            const hasEnoughLeftSpace = triggerRect.right - menuRect.width >= viewportPadding;
            setMenuAlignment(wouldOverflowRight && hasEnoughLeftSpace ? 'right' : 'left');
        };

        const rafId = window.requestAnimationFrame(updateMenuAlignment);
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('resize', updateMenuAlignment);
        return () => {
            window.cancelAnimationFrame(rafId);
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('resize', updateMenuAlignment);
        };
    }, [isOpen]);

    const canIncludeType = (configType: ConfigType): boolean => {
        if (configType === 'APP_ID') {
            return false;
        }
        if (!allowedTypes) {
            return true;
        }
        return allowedTypes.includes(configType);
    };

    const filteredProjectConfigs = projectConfigs.filter((config) => canIncludeType(config.type));
    const filteredTestCaseConfigs = testCaseConfigs.filter((config) => canIncludeType(config.type));
    const availableTestFiles = canIncludeType('FILE') ? (testFiles || []) : [];

    if (filteredProjectConfigs.length === 0 && filteredTestCaseConfigs.length === 0 && availableTestFiles.length === 0) {
        return null;
    }

    const overriddenNames = new Set(filteredTestCaseConfigs.map((config) => config.name));

    const buildConfigReference = (config: ConfigItem): string => {
        if (formatRef) {
            return formatRef(config);
        }
        if (config.type === 'FILE') {
            return `{{file:${config.filename || config.name}}}`;
        }
        return `{{${config.name}}}`;
    };

    const handleSelectConfig = (config: ConfigItem) => {
        onInsert(buildConfigReference(config));
        setIsOpen(false);
    };

    const handleSelectTestFile = (file: TestCaseFile) => {
        const reference = formatTestFileRef ? formatTestFileRef(file) : `{{file:${file.filename}}}`;
        onInsert(reference);
        onInsertTestFile?.(file);
        setIsOpen(false);
    };

    const renderConfigGroups = (groups: ConfigGroup[]) => {
        return groups.map((group) => (
            <div key={group.key}>
                {group.label && (
                    <div className="px-3 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-y border-gray-100">
                        {group.label}
                    </div>
                )}
                {group.configs.map((config) => (
                    <button
                        key={`${config.source}-${config.id}`}
                        type="button"
                        onClick={() => handleSelectConfig(config)}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center justify-between gap-3 ${config.source === 'project' && overriddenNames.has(config.name) ? 'opacity-50 line-through' : ''}`}
                    >
                        <div className="min-w-0 flex-1">
                            <code className="block font-mono text-xs text-gray-700 truncate">{config.name}</code>
                            <span className="block text-[10px] text-gray-400 truncate">{getPreviewValue(config)}</span>
                        </div>
                        <span className="text-[10px] font-semibold uppercase text-gray-400">
                            {config.type === 'APP_ID' ? 'VAR' : TYPE_SHORT_LABEL[config.type]}
                        </span>
                    </button>
                ))}
            </div>
        ));
    };

    const mergedConfigs: DropdownConfigItem[] = [
        ...filteredProjectConfigs.map((config) => ({ ...config, source: 'project' as const })),
        ...filteredTestCaseConfigs.map((config) => ({ ...config, source: 'test-case' as const })),
    ];
    const groupedConfigs = groupConfigs(mergedConfigs);

    return (
        <div className="relative inline-block" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="text-xs flex items-center gap-1 text-gray-500 hover:text-gray-700 font-medium px-2 py-1 rounded hover:bg-gray-100 transition-colors"
            >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
                {t('configs.insertVariable')}
            </button>

            {isOpen && (
                <div
                    ref={menuRef}
                    className={`absolute top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-[70] py-1 w-[min(22rem,calc(100vw-2rem))] max-h-72 overflow-y-auto ${menuAlignment === 'right' ? 'right-0' : 'left-0'}`}
                >
                    {mergedConfigs.length > 0 && <>{renderConfigGroups(groupedConfigs)}</>}

                    {availableTestFiles.length > 0 && (
                        <>
                            {availableTestFiles.map((file) => (
                                <button
                                    key={`f-${file.id}`}
                                    type="button"
                                    onClick={() => handleSelectTestFile(file)}
                                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center justify-between gap-3"
                                >
                                    <code className="font-mono text-xs text-gray-700 truncate">{file.filename}</code>
                                    <span className="text-[10px] font-semibold uppercase text-gray-400">FIL</span>
                                </button>
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
