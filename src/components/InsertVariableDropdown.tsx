'use client';

import { useState, useRef, useEffect } from 'react';
import { useI18n } from '@/i18n';
import type { ConfigItem, ConfigType } from '@/types';

interface InsertVariableDropdownProps {
    projectConfigs: ConfigItem[];
    testCaseConfigs: ConfigItem[];
    onInsert: (ref: string) => void;
}

export default function InsertVariableDropdown({
    projectConfigs,
    testCaseConfigs,
    onInsert,
}: InsertVariableDropdownProps) {
    const { t } = useI18n();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const allConfigs = [...projectConfigs, ...testCaseConfigs];
    if (allConfigs.length === 0) return null;

    const overriddenNames = new Set(testCaseConfigs.map(c => c.name));

    const getTypeIcon = (type: ConfigType) => {
        switch (type) {
            case 'URL': return '🔗';
            case 'VARIABLE': return '📝';
            case 'SECRET': return '🔒';
            case 'FILE': return '📎';
        }
    };

    const handleSelect = (config: ConfigItem) => {
        const ref = config.type === 'FILE'
            ? `{{file:${config.filename || config.name}}}`
            : `{{${config.name}}}`;
        onInsert(ref);
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
                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 min-w-[200px] max-h-[300px] overflow-y-auto">
                    {projectConfigs.length > 0 && (
                        <>
                            <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                                {t('configs.section.project')}
                            </div>
                            {projectConfigs.map(config => (
                                <button
                                    key={`p-${config.id}`}
                                    type="button"
                                    onClick={() => handleSelect(config)}
                                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2 ${overriddenNames.has(config.name) ? 'opacity-50 line-through' : ''}`}
                                >
                                    <span className="text-xs">{getTypeIcon(config.type)}</span>
                                    <code className="font-mono text-xs text-gray-700">{config.name}</code>
                                </button>
                            ))}
                        </>
                    )}
                    {testCaseConfigs.length > 0 && (
                        <>
                            <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-t border-gray-100 mt-1">
                                {t('configs.section.testCase')}
                            </div>
                            {testCaseConfigs.map(config => (
                                <button
                                    key={`tc-${config.id}`}
                                    type="button"
                                    onClick={() => handleSelect(config)}
                                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                                >
                                    <span className="text-xs">{getTypeIcon(config.type)}</span>
                                    <code className="font-mono text-xs text-gray-700">{config.name}</code>
                                </button>
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
