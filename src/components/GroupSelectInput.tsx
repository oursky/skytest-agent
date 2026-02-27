'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n';

interface GroupSelectInputProps {
    value: string;
    onChange: (value: string) => void;
    options: string[];
    placeholder: string;
    onRemoveOption?: (group: string) => Promise<void> | void;
    disabled?: boolean;
    containerClassName?: string;
    inputClassName?: string;
}

function normalize(value: string): string {
    return value.trim();
}

export default function GroupSelectInput({
    value,
    onChange,
    options,
    placeholder,
    onRemoveOption,
    disabled = false,
    containerClassName,
    inputClassName,
}: GroupSelectInputProps) {
    const { t } = useI18n();
    const rootRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [removingGroup, setRemovingGroup] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [open]);

    const sortedOptions = useMemo(
        () => [...options].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
        [options]
    );

    const normalizedValue = normalize(value);

    const filteredOptions = useMemo(() => {
        if (!normalizedValue) {
            return sortedOptions;
        }
        return sortedOptions.filter((option) => option.toLowerCase().includes(normalizedValue.toLowerCase()));
    }, [normalizedValue, sortedOptions]);

    const canCreate = normalizedValue.length > 0
        && !sortedOptions.some((option) => option.localeCompare(normalizedValue, undefined, { sensitivity: 'base' }) === 0);

    const handleSelect = (nextValue: string) => {
        onChange(nextValue);
        setOpen(false);
    };

    const handleRemove = async (group: string) => {
        if (!onRemoveOption) return;
        setRemovingGroup(group);
        try {
            await onRemoveOption(group);
        } finally {
            setRemovingGroup(null);
        }
    };

    return (
        <div className={containerClassName || 'relative w-full md:w-72'} ref={rootRef}>
            <input
                type="text"
                value={value}
                disabled={disabled}
                onFocus={() => setOpen(true)}
                onChange={(event) => {
                    onChange(event.target.value);
                    setOpen(true);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        setOpen(false);
                        return;
                    }
                    if (event.key === 'Enter') {
                        const nextValue = normalize((event.currentTarget as HTMLInputElement).value);
                        if (nextValue.length > 0) {
                            event.preventDefault();
                            event.stopPropagation();
                            handleSelect(nextValue);
                        }
                    }
                }}
                placeholder={placeholder}
                className={inputClassName}
            />

            {open && (
                <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {canCreate && (
                        <button
                            type="button"
                            onClick={() => handleSelect(normalizedValue)}
                            className="w-full px-3 py-2 text-left text-xs text-primary hover:bg-blue-50"
                        >
                            {t('configs.group.useTyped', { value: normalizedValue })}
                        </button>
                    )}

                    {filteredOptions.map((option) => (
                        <div key={option} className="flex items-center gap-1 border-t border-gray-100 first:border-t-0">
                            <button
                                type="button"
                                onClick={() => handleSelect(option)}
                                className="flex-1 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
                            >
                                {option}
                            </button>
                            {onRemoveOption && (
                                <button
                                    type="button"
                                    disabled={removingGroup === option}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void handleRemove(option);
                                    }}
                                    className="mr-1 inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                                    title={t('configs.group.remove')}
                                >
                                    <span aria-hidden="true">×</span>
                                </button>
                            )}
                        </div>
                    ))}

                    {!canCreate && filteredOptions.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-400">{t('configs.group.noOptions')}</div>
                    )}
                </div>
            )}
        </div>
    );
}
