'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/auth-provider';
import { useI18n } from '@/i18n';
import { fetchWithAccessToken } from '@/app/run/run-page-api';

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
                        <li key={id} className="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs">
                            <span className="w-5 text-gray-400">{index + 1}</span>
                            <span className="flex-1 truncate">{label(id)}</span>
                            <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="px-1 text-gray-500 disabled:opacity-30" aria-label={t('runGroup.items.moveUp')}>↑</button>
                            <button type="button" onClick={() => move(index, 1)} disabled={index === value.length - 1} className="px-1 text-gray-500 disabled:opacity-30" aria-label={t('runGroup.items.moveDown')}>↓</button>
                            <button type="button" onClick={() => onChange(value.filter((v) => v !== id))} className="px-1 text-gray-400 hover:text-red-500" aria-label={t('common.remove')}>✕</button>
                        </li>
                    ))}
                </ol>
            )}
            {available.length > 0 && (
                <select
                    value=""
                    onChange={(event) => { if (event.target.value) onChange([...value, event.target.value]); }}
                    className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                >
                    <option value="">{t('runGroup.items.add')}</option>
                    {available.map((option) => (
                        <option key={option.id} value={option.id}>
                            {option.displayId ? `${option.displayId} ${option.name}` : option.name}
                        </option>
                    ))}
                </select>
            )}
        </div>
    );
}
