'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { CustomSelect } from '@/components/shared';

interface TestCaseOption {
    id: string;
    displayId?: string | null;
    name: string;
}

interface OrderedTestCasePickerProps {
    projectId: string;
    value: string[];
    onChange: (testCaseIds: string[]) => void;
}

export default function OrderedTestCasePicker({ projectId, value, onChange }: OrderedTestCasePickerProps) {
    const { t } = useI18n();
    const { getAccessToken } = useAuth();
    const [options, setOptions] = useState<TestCaseOption[]>([]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetchWithAccessToken(
                    getAccessToken,
                    `/api/projects/${projectId}/test-cases?summary=1&kind=TEST&limit=100`,
                );
                if (!response.ok) {
                    return;
                }
                const body = await response.json() as { data?: TestCaseOption[] };
                if (!cancelled && Array.isArray(body.data)) {
                    setOptions(body.data);
                }
            } catch {
                // Leave the list empty on failure; the picker just shows nothing to add.
            }
        })();
        return () => { cancelled = true; };
    }, [projectId, getAccessToken]);

    const optionById = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
    const available = options.filter((option) => !value.includes(option.id));

    const label = (id: string) => {
        const option = optionById.get(id);
        if (!option) return id;
        return option.displayId ? `${option.displayId} ${option.name}` : option.name;
    };

    const move = (index: number, delta: number) => {
        const next = [...value];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };

    return (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">{t('runGroup.items')}</label>
            {value.length === 0 ? (
                <p className="text-xs text-gray-500">{t('runGroup.items.empty')}</p>
            ) : (
                <ol className="space-y-1">
                    {value.map((id, index) => (
                        <li key={id} className="flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs">
                            <span className="w-5 shrink-0 text-gray-400">{index + 1}</span>
                            <span className="flex-1 truncate">{label(id)}</span>
                            <button
                                type="button"
                                onClick={() => move(index, -1)}
                                disabled={index === 0}
                                className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-30"
                                aria-label={t('runGroup.items.moveUp')}
                            >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                            </button>
                            <button
                                type="button"
                                onClick={() => move(index, 1)}
                                disabled={index === value.length - 1}
                                className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-30"
                                aria-label={t('runGroup.items.moveDown')}
                            >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </button>
                            <button
                                type="button"
                                onClick={() => onChange(value.filter((v) => v !== id))}
                                className="rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                aria-label={t('common.remove')}
                            >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </li>
                    ))}
                </ol>
            )}
            {available.length > 0 && (
                <CustomSelect
                    value=""
                    options={[
                        { value: '', label: t('runGroup.items.add') },
                        ...available.map((option) => ({
                            value: option.id,
                            label: option.displayId ? `${option.displayId} ${option.name}` : option.name,
                        })),
                    ]}
                    onChange={(next) => { if (next) onChange([...value, next]); }}
                    fullWidth
                    ariaLabel={t('runGroup.items.add')}
                    buttonClassName="px-2 py-1.5 text-xs"
                />
            )}
        </div>
    );
}
