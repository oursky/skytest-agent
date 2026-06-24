'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { CustomSelect } from '@/components/shared';
import { extractListData } from '@/utils/pagination/pagination';

interface LoginFlowOption {
    id: string;
    displayId?: string | null;
    name: string;
}

interface LoginFlowSelectProps {
    projectId?: string;
    value?: string;
    excludeTestCaseId?: string;
    disabled?: boolean;
    size?: 'sm' | 'md';
    labelSeparator?: string;
    onChange: (loginFlowId: string | undefined) => void;
}

export default function LoginFlowSelect({
    projectId,
    value,
    excludeTestCaseId,
    disabled,
    size = 'sm',
    labelSeparator = ' ',
    onChange,
}: LoginFlowSelectProps) {
    const { t } = useI18n();
    const { getAccessToken } = useAuth();
    const [options, setOptions] = useState<LoginFlowOption[]>([]);
    const [open, setOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!projectId) {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetchWithAccessToken(
                    getAccessToken,
                    `/api/projects/${projectId}/test-cases?summary=1&kind=LOGIN_FLOW&limit=100`,
                );
                if (!response.ok) {
                    return;
                }
                const options = extractListData<LoginFlowOption>(await response.json());
                if (!cancelled) {
                    setOptions(options);
                }
            } catch {
                // A failed lookup just leaves the picker empty; the field stays optional.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [projectId, getAccessToken]);

    const selectOptions = useMemo(() => {
        const visibleOptions = options.filter((option) => option.id !== excludeTestCaseId);
        return [
            { value: '', label: t('configs.browser.loginFlow.none') },
            ...visibleOptions.map((option) => ({
                value: option.id,
                label: option.displayId ? `${option.displayId}${labelSeparator}${option.name}` : option.name,
            })),
        ];
    }, [options, excludeTestCaseId, labelSeparator, t]);

    useEffect(() => {
        if (!open) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    if (size === 'md') {
        return (
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('configs.browser.loginFlow')}</label>
                <CustomSelect
                    value={value ?? ''}
                    options={selectOptions}
                    onChange={(next) => onChange(next || undefined)}
                    disabled={disabled}
                    fullWidth
                    ariaLabel={t('configs.browser.loginFlow')}
                />
            </div>
        );
    }

    const selectedLabel = selectOptions.find((option) => option.value === (value ?? ''))?.label ?? '';

    return (
        <div>
            <label className="text-[10px] font-medium text-gray-500 uppercase">{t('configs.browser.loginFlow')}</label>
            <div className={`flex mt-0.5 border border-gray-300 rounded bg-white ${disabled ? 'opacity-50' : 'focus-within:ring-1 focus-within:ring-primary focus-within:border-primary'}`}>
                <button
                    type="button"
                    onClick={() => !disabled && setOpen((prev) => !prev)}
                    disabled={disabled}
                    className="flex-1 min-w-0 px-2 py-1.5 text-xs text-left text-gray-700 bg-white rounded-l focus:outline-none"
                >
                    <span className="block truncate">{selectedLabel}</span>
                </button>
                <div className="relative" ref={dropdownRef}>
                    <button
                        type="button"
                        onClick={() => !disabled && setOpen((prev) => !prev)}
                        disabled={disabled}
                        className="h-full px-2 border-l border-gray-300 rounded-r bg-white hover:bg-gray-50 text-gray-500 flex items-center"
                        aria-label={t('configs.browser.loginFlow')}
                    >
                        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                    {open && (
                        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1 w-72 max-w-[calc(100vw-2rem)]">
                            {selectOptions.map((option) => (
                                <button
                                    key={option.value || 'none'}
                                    type="button"
                                    onClick={() => {
                                        onChange(option.value || undefined);
                                        setOpen(false);
                                    }}
                                    className={`w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 ${option.value === (value ?? '') ? 'font-medium text-primary' : 'text-gray-700'}`}
                                >
                                    <span className="block truncate">{option.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
