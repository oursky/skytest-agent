'use client';

import { useState, useRef, useEffect } from 'react';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType, TestCaseFile } from '@/types';

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
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
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

    const filteredProjectConfigs = allowedTypes
        ? projectConfigs.filter(config => allowedTypes.includes(config.type))
        : projectConfigs;
    const filteredTestCaseConfigs = allowedTypes
        ? testCaseConfigs.filter(config => allowedTypes.includes(config.type))
        : testCaseConfigs;
    const availableTestFiles = testFiles || [];

    const allConfigs = [...filteredProjectConfigs, ...filteredTestCaseConfigs];
    if (allConfigs.length === 0 && availableTestFiles.length === 0) return null;

    const overriddenNames = new Set(filteredTestCaseConfigs.map(c => c.name));

    const buildConfigReference = (config: ConfigItem): string => {
        if (formatRef) {
            return formatRef(config);
        }
        return config.type === 'FILE'
            ? `{{file:${config.filename || config.name}}}`
            : `{{${config.name}}}`;
    };

    const handleSelect = (config: ConfigItem) => {
        const ref = buildConfigReference(config);
        onInsert(ref);
        setIsOpen(false);
    };

    const handleSelectTestFile = (file: TestCaseFile) => {
        const ref = formatTestFileRef
            ? formatTestFileRef(file)
            : `{{file:${file.filename}}}`;
        onInsert(ref);
        onInsertTestFile?.(file);
        setIsOpen(false);
    };

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
                    className={`absolute top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-[70] py-1 w-[min(20rem,calc(100vw-2rem))] max-h-[min(300px,50vh)] overflow-y-auto ${menuAlignment === 'right' ? 'right-0' : 'left-0'}`}
                >
                    {filteredProjectConfigs.length > 0 && (
                        <>
                            <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                                {t('configs.section.projectVariables')}
                            </div>
                            {filteredProjectConfigs.map(config => (
                                <button
                                    key={`p-${config.id}`}
                                    type="button"
                                    onClick={() => handleSelect(config)}
                                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center justify-between gap-3 ${overriddenNames.has(config.name) ? 'opacity-50 line-through' : ''}`}
                                >
                                    <code className="font-mono text-xs text-gray-700">{config.name}</code>
                                    <span className="text-[10px] font-semibold uppercase text-gray-400">{config.type}</span>
                                </button>
                            ))}
                        </>
                    )}
                    {filteredTestCaseConfigs.length > 0 && (
                        <>
                            <div
                                className={`px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider ${filteredProjectConfigs.length > 0 ? 'border-t border-gray-100 mt-1' : ''}`}
                            >
                                {t('configs.section.testCaseVariables')}
                            </div>
                            {filteredTestCaseConfigs.map(config => (
                                <button
                                    key={`tc-${config.id}`}
                                    type="button"
                                    onClick={() => handleSelect(config)}
                                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center justify-between gap-3"
                                >
                                    <code className="font-mono text-xs text-gray-700">{config.name}</code>
                                    <span className="text-[10px] font-semibold uppercase text-gray-400">{config.type}</span>
                                </button>
                            ))}
                        </>
                    )}
                    {availableTestFiles.length > 0 && (
                        <>
                            <div
                                className={`px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider ${(filteredProjectConfigs.length > 0 || filteredTestCaseConfigs.length > 0) ? 'border-t border-gray-100 mt-1' : ''}`}
                            >
                                {t('configs.title.files')}
                            </div>
                            {availableTestFiles.map(file => (
                                <button
                                    key={`f-${file.id}`}
                                    type="button"
                                    onClick={() => handleSelectTestFile(file)}
                                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center justify-between gap-3"
                                >
                                    <code className="font-mono text-xs text-gray-700 truncate">{file.filename}</code>
                                    <span className="text-[10px] font-semibold uppercase text-gray-400">{t('configs.type.file')}</span>
                                </button>
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
