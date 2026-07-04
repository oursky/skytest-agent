'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n';
import { CustomSelect } from '@/components/shared';
import type { TestCaseTargetSummary } from '@/types';

export interface TestCaseOption {
    id: string;
    displayId?: string | null;
    name: string;
    targets?: TestCaseTargetSummary[];
}

interface OrderedTestCasePickerProps {
    options: TestCaseOption[];
    value: string[];
    onChange: (testCaseIds: string[]) => void;
    readOnly?: boolean;
    loginSessions: { loginFlowId: string; name: string }[];
    resolveLoginFlowName: (loginFlowId: string) => string;
}

export default function OrderedTestCasePicker({ options, value, onChange, readOnly = false, loginSessions, resolveLoginFlowName }: OrderedTestCasePickerProps) {
    const { t } = useI18n();
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const optionById = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
    const available = options.filter((option) => !value.includes(option.id));

    const label = (id: string) => {
        const option = optionById.get(id);
        if (!option) return id;
        return option.displayId ? `${option.displayId} • ${option.name}` : option.name;
    };

    /** The group login session a target reuses: matched by login flow + the target's reuse flag. */
    const mappedSessionName = (target: TestCaseTargetSummary): string | null => {
        if (!target.loginFlowId || !target.reuseEnabled) {
            return null;
        }
        return loginSessions.find((session) => session.loginFlowId === target.loginFlowId)?.name ?? null;
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
            <label className="block text-sm font-medium text-foreground">{t('testGroup.items')}</label>
            {value.length === 0 ? (
                <p className="text-sm text-gray-500">{t('testGroup.items.empty')}</p>
            ) : (
                <ol className="space-y-1.5">
                    {value.map((id, index) => {
                        const targets = optionById.get(id)?.targets ?? [];
                        const isExpanded = expandedId === id;
                        return (
                            <li key={id} className="rounded-md border border-gray-200 bg-white">
                                <div className="flex items-center gap-2 px-3 py-2 text-sm">
                                    <span className="w-5 shrink-0 text-gray-400">{index + 1}</span>
                                    <span className="flex-1 truncate text-gray-900">{label(id)}</span>
                                    {targets.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setExpandedId(isExpanded ? null : id)}
                                            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                                            aria-expanded={isExpanded}
                                        >
                                            {t('testGroup.sessions')}
                                            <svg className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => move(index, -1)}
                                        disabled={readOnly || index === 0}
                                        className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-30"
                                        aria-label={t('testGroup.items.moveUp')}
                                    >
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => move(index, 1)}
                                        disabled={readOnly || index === value.length - 1}
                                        className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-30"
                                        aria-label={t('testGroup.items.moveDown')}
                                    >
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onChange(value.filter((v) => v !== id))}
                                        disabled={readOnly}
                                        className="rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-30"
                                        aria-label={t('common.remove')}
                                    >
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                                {isExpanded && targets.length > 0 && (
                                    <div className="border-t border-gray-100 bg-gray-50/60 px-3 py-2">
                                        {targets.map((target) => {
                                            const mapped = mappedSessionName(target);
                                            return (
                                                <div key={target.key} className="grid grid-cols-3 gap-2 py-0.5 text-xs">
                                                    <span className="truncate text-gray-700">{target.label}</span>
                                                    <span className="truncate text-gray-500">{target.loginFlowId ? resolveLoginFlowName(target.loginFlowId) : '—'}</span>
                                                    {mapped ? (
                                                        <span className="truncate font-medium text-primary">{mapped}</span>
                                                    ) : (
                                                        <span className="truncate text-gray-400">{t('testGroup.sessions.notApplicable')}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}
            {!readOnly && available.length > 0 && (
                <CustomSelect
                    value=""
                    options={[
                        { value: '', label: t('testGroup.items.add') },
                        ...available.map((option) => ({
                            value: option.id,
                            label: option.displayId ? `${option.displayId} • ${option.name}` : option.name,
                        })),
                    ]}
                    onChange={(next) => { if (next) onChange([...value, next]); }}
                    fullWidth
                    ariaLabel={t('testGroup.items.add')}
                />
            )}
        </div>
    );
}
