"use client";
import type { MutableRefObject, RefObject } from "react";
import Link from "next/link";
import { formatDateTimeCompact } from "@/utils/time/dateFormatter";
import { getStatusBadgeClass } from '@/utils/status/statusBadge';
import { isActiveRunStatus } from '@/utils/status/statusHelpers';
import type { TranslationVars } from '@/i18n';
import type { TestCase } from './project-page.types';

interface ProjectTestCaseRowProps {
    testCase: TestCase;
    projectId: string;
    isSelected: boolean;
    canSelect?: boolean;
    onToggleSelect: (testCaseId: string) => void;
    isEditingDisplayId: boolean;
    isSavingDisplayId: boolean;
    editingDisplayIdValue: string;
    onEditingDisplayIdValueChange: (value: string) => void;
    displayIdInputRef: RefObject<HTMLInputElement | null>;
    skipBlurSaveRef: MutableRefObject<boolean>;
    onStartDisplayIdEdit: (testCase: TestCase) => void;
    onSaveDisplayId: (testCase: TestCase) => void;
    onClearDisplayIdEdit: () => void;
    onCloneTestCase: (testCaseId: string) => void;
    onRequestDelete: (testCase: TestCase) => void;
    t: (key: string, vars?: TranslationVars) => string;
}

export default function ProjectTestCaseRow({
    testCase,
    projectId,
    isSelected,
    canSelect = true,
    onToggleSelect,
    isEditingDisplayId,
    isSavingDisplayId,
    editingDisplayIdValue,
    onEditingDisplayIdValueChange,
    displayIdInputRef,
    skipBlurSaveRef,
    onStartDisplayIdEdit,
    onSaveDisplayId,
    onClearDisplayIdEdit,
    onCloneTestCase,
    onRequestDelete,
    t,
}: ProjectTestCaseRowProps) {
    const latestRunStatus = testCase.testRuns[0]?.status;
    const currentStatus = latestRunStatus && isActiveRunStatus(latestRunStatus)
        ? latestRunStatus
        : testCase.status;

    return (
        <div className="flex flex-col md:grid md:grid-cols-24 gap-4 p-4 hover:bg-gray-50 transition-colors group">
            <div className="md:col-span-1 flex items-center">
                <input
                    type="checkbox"
                    checked={canSelect && isSelected}
                    onChange={() => {
                        if (canSelect) {
                            onToggleSelect(testCase.id);
                        }
                    }}
                    disabled={!canSelect}
                    aria-label={t('project.table.selectOne', { name: testCase.name })}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-30"
                />
            </div>
            <div className="md:col-span-3 flex items-center">
                {isEditingDisplayId ? (
                    <input
                        ref={displayIdInputRef}
                        type="text"
                        value={editingDisplayIdValue}
                        onChange={(event) => onEditingDisplayIdValueChange(event.target.value)}
                        onBlur={() => {
                            if (skipBlurSaveRef.current) {
                                skipBlurSaveRef.current = false;
                                onClearDisplayIdEdit();
                                return;
                            }

                            void onSaveDisplayId(testCase);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.currentTarget.blur();
                            }

                            if (event.key === 'Escape') {
                                skipBlurSaveRef.current = true;
                                event.currentTarget.blur();
                            }
                        }}
                        className="w-full rounded-md border border-primary/40 bg-white px-2 py-1 text-xs font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/40"
                        aria-label={t('project.table.id')}
                    />
                ) : testCase.displayId ? (
                    <button
                        type="button"
                        onClick={() => onStartDisplayIdEdit(testCase)}
                        disabled={isSavingDisplayId}
                        className="text-xs text-gray-500 font-mono hover:text-primary transition-colors disabled:opacity-60"
                    >
                        {testCase.displayId}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => onStartDisplayIdEdit(testCase)}
                        disabled={isSavingDisplayId}
                        className="text-gray-400 text-sm hover:text-primary transition-colors disabled:opacity-60"
                    >
                        -
                    </button>
                )}
            </div>
            <div className="md:col-span-8 flex items-center">
                <Link
                    href={`/run?testCaseId=${testCase.id}&projectId=${projectId}`}
                    className="font-medium text-gray-900 hover:text-primary transition-colors"
                >
                    {testCase.name}
                </Link>
            </div>
            <div className="flex items-center gap-4 md:contents">
                <div className="md:col-span-3 flex items-center">
                    {currentStatus ? (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusBadgeClass(currentStatus)}`}>
                            {currentStatus}
                        </span>
                    ) : (
                        <span className="text-gray-400 text-sm">-</span>
                    )}
                </div>
                <div className="md:col-span-4 text-sm text-gray-500 flex items-center">
                    {formatDateTimeCompact(testCase.updatedAt)}
                </div>
                <div className="md:col-span-5 flex justify-end gap-2">
                    {(!testCase.testRuns[0] || !isActiveRunStatus(testCase.testRuns[0].status)) && (
                        <Link
                            href={`/run?testCaseId=${testCase.id}&name=${encodeURIComponent(testCase.name)}`}
                            className="p-2 text-gray-500 hover:text-primary hover:bg-primary/10 rounded-md transition-colors inline-flex items-center justify-center"
                            title={t('project.tooltip.run')}
                            aria-label={t('project.tooltip.run')}
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </Link>
                    )}
                    {testCase.testRuns[0] && isActiveRunStatus(testCase.testRuns[0].status) && (
                        <Link
                            href={`/run?runId=${testCase.testRuns[0].id}&testCaseId=${testCase.id}`}
                            className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors inline-flex items-center justify-center animate-pulse"
                            title={t('project.tooltip.viewRunning')}
                            aria-label={t('project.tooltip.viewRunning')}
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                        </Link>
                    )}
                    <Link
                        href={`/test-cases/${testCase.id}/history`}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors inline-flex items-center justify-center"
                        title={t('project.tooltip.viewHistory')}
                        aria-label={t('project.tooltip.viewHistory')}
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </Link>
                    <button
                        onClick={() => onCloneTestCase(testCase.id)}
                        className="cursor-pointer p-2 text-gray-500 hover:text-primary hover:bg-primary/10 rounded-md transition-colors inline-flex items-center justify-center"
                        title={t('project.tooltip.clone')}
                        aria-label={t('project.tooltip.clone')}
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    </button>
                    <button
                        onClick={() => onRequestDelete(testCase)}
                        disabled={testCase.testRuns[0] && isActiveRunStatus(testCase.testRuns[0].status)}
                        className={`p-2 rounded-md transition-colors inline-flex items-center justify-center ${testCase.testRuns[0] && isActiveRunStatus(testCase.testRuns[0].status)
                            ? 'text-gray-300 cursor-not-allowed'
                            : 'cursor-pointer text-gray-400 hover:text-red-600 hover:bg-red-50'
                            }`}
                        title={testCase.testRuns[0] && isActiveRunStatus(testCase.testRuns[0].status)
                            ? t('project.tooltip.cannotDeleteRunning')
                            : t('project.tooltip.delete')}
                        aria-label={t('project.tooltip.delete')}
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
