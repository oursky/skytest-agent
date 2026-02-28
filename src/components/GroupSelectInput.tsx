'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { normalizeConfigGroup } from '@/lib/config-sort';

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
    return normalizeConfigGroup(value);
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
    const [query, setQuery] = useState('');
    const [pendingRemoveGroup, setPendingRemoveGroup] = useState<string | null>(null);
    const [removingGroup, setRemovingGroup] = useState<string | null>(null);

    const selectedGroup = normalize(value);
    const normalizedQuery = normalize(query);

    useEffect(() => {
        if (!open) {
            setQuery('');
        }
    }, [open]);

    const sortedOptions = useMemo(
        () => [...options].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
        [options]
    );

    const filteredOptions = useMemo(() => {
        if (!normalizedQuery) {
            return sortedOptions;
        }
        return sortedOptions.filter((option) => option.toLowerCase().includes(normalizedQuery.toLowerCase()));
    }, [normalizedQuery, sortedOptions]);

    const canCreate = normalizedQuery.length > 0
        && !sortedOptions.some((option) => option.localeCompare(normalizedQuery, undefined, { sensitivity: 'base' }) === 0);

    const handleSelect = (nextValue: string) => {
        onChange(nextValue);
        setOpen(false);
        setQuery('');
    };

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                if (canCreate) {
                    handleSelect(normalizedQuery);
                    return;
                }
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [canCreate, normalizedQuery, open]);

    const handleConfirmRemove = async () => {
        if (!onRemoveOption || !pendingRemoveGroup) return;

        setRemovingGroup(pendingRemoveGroup);
        try {
            await onRemoveOption(pendingRemoveGroup);
            if (selectedGroup.localeCompare(pendingRemoveGroup, undefined, { sensitivity: 'base' }) === 0) {
                onChange('');
            }
            setPendingRemoveGroup(null);
            setOpen(false);
        } finally {
            setRemovingGroup(null);
        }
    };

    const controlClasses = [
        'h-8 w-full rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus-within:border-transparent focus-within:ring-2 focus-within:ring-primary',
        inputClassName || '',
    ].join(' ').trim();

    return (
        <>
            <div className={containerClassName || 'relative w-full'} ref={rootRef}>
                <div
                    className={controlClasses}
                    onClick={() => {
                        if (!disabled) {
                            setOpen(true);
                        }
                    }}
                >
                    <div className="flex h-full items-center gap-1.5">
                        {selectedGroup && (
                            <span className="inline-flex max-w-full items-center rounded-md bg-gray-100 px-2 py-0.5 text-inherit font-medium text-gray-700">
                                <span className="truncate">{selectedGroup}</span>
                            </span>
                        )}
                        <input
                            type="text"
                            value={query}
                            disabled={disabled}
                            onFocus={() => setOpen(true)}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setOpen(true);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                    setOpen(false);
                                    return;
                                }
                                if (event.key === 'Backspace' && query.length === 0 && selectedGroup.length > 0) {
                                    onChange('');
                                    return;
                                }
                                if (event.key === 'Enter') {
                                    if (normalizedQuery.length > 0) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        handleSelect(normalizedQuery);
                                    }
                                }
                                if (event.key === 'Tab' && canCreate) {
                                    handleSelect(normalizedQuery);
                                }
                            }}
                            placeholder={selectedGroup ? '' : placeholder}
                            className="min-w-[84px] flex-1 bg-transparent text-inherit text-gray-700 placeholder:text-gray-400 focus:outline-none"
                        />
                    </div>
                </div>

                {open && (
                    <div className="absolute left-0 right-0 top-full z-[70] mt-1 max-h-52 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                        {canCreate && (
                            <button
                                type="button"
                                onClick={() => handleSelect(normalizedQuery)}
                                className="w-full px-3 py-2 text-left text-xs text-primary hover:bg-blue-50"
                            >
                                {t('configs.group.addOption', { value: normalizedQuery })}
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
                                            setPendingRemoveGroup(option);
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

            {pendingRemoveGroup && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4">
                    <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
                        <div className="border-b border-gray-200 px-4 py-3">
                            <h3 className="text-sm font-semibold text-gray-900">{t('configs.group.removeDialog.title')}</h3>
                        </div>
                        <div className="px-4 py-4">
                            <p className="text-sm text-gray-600">
                                {t('configs.group.removeDialog.message', { group: pendingRemoveGroup })}
                            </p>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
                            <button
                                type="button"
                                onClick={() => setPendingRemoveGroup(null)}
                                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                                disabled={Boolean(removingGroup)}
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={() => { void handleConfirmRemove(); }}
                                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                                disabled={Boolean(removingGroup)}
                            >
                                {t('configs.group.removeDialog.confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
