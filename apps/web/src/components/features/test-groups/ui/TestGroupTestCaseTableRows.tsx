'use client';

import { useI18n } from '@/i18n';
import type { TestGroupTestCaseOption } from '../model/test-case-selection';

interface TestGroupTestCaseTableRowsProps {
    testCase: TestGroupTestCaseOption;
    targets: NonNullable<TestGroupTestCaseOption['targets']>;
    isSelected: boolean;
    selectedIndex: number;
    selectedCount: number;
    isExpanded: boolean;
    showOrderActions: boolean;
    readOnly: boolean;
    toggleExpanded: () => void;
    toggleSelected: (checked: boolean) => void;
    move: (delta: -1 | 1) => void;
    mappedSessionName: (loginFlowId: string | null, reuseEnabled: boolean) => string | null;
    resolveLoginFlowName: (loginFlowId: string) => string;
}

export default function TestGroupTestCaseTableRows({
    testCase,
    targets,
    isSelected,
    selectedIndex,
    selectedCount,
    isExpanded,
    showOrderActions,
    readOnly,
    toggleExpanded,
    toggleSelected,
    move,
    mappedSessionName,
    resolveLoginFlowName,
}: TestGroupTestCaseTableRowsProps) {
    const { t } = useI18n();

    return (
        <>
            <tr>
                <td className="px-3 py-2">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) => toggleSelected(event.target.checked)}
                        disabled={readOnly}
                        aria-label={t('testGroup.items.selectCase', { name: testCase.name })}
                        className="h-4 w-4"
                    />
                </td>
                <td className="px-3 py-2 text-gray-600">{isSelected ? selectedIndex + 1 : '—'}</td>
                <td className="px-3 py-2 text-gray-600">{testCase.displayId || '—'}</td>
                <td className="px-3 py-2 text-gray-900">{testCase.name}</td>
                <td className="px-3 py-2">
                    {targets.length > 0 && (
                        <button
                            type="button"
                            onClick={toggleExpanded}
                            aria-expanded={isExpanded}
                            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                        >
                            {t('common.show')}
                            <svg className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                    )}
                </td>
                <td className="px-3 py-2">
                    {showOrderActions && isSelected && (
                        <div className="flex justify-end gap-1">
                            <button
                                type="button"
                                onClick={() => move(-1)}
                                disabled={readOnly || selectedIndex === 0}
                                aria-label={t('testGroup.items.moveUp')}
                                className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-30"
                            >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                            </button>
                            <button
                                type="button"
                                onClick={() => move(1)}
                                disabled={readOnly || selectedIndex === selectedCount - 1}
                                aria-label={t('testGroup.items.moveDown')}
                                className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-30"
                            >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </button>
                        </div>
                    )}
                </td>
            </tr>
            {isExpanded && targets.length > 0 && (
                <tr className="bg-gray-50/60">
                    <td colSpan={6} className="px-4 py-2">
                        {targets.map((target) => {
                            const mapped = mappedSessionName(target.loginFlowId, target.reuseEnabled);
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
                    </td>
                </tr>
            )}
        </>
    );
}
