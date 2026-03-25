'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/i18n';
import { joinClasses } from './class-names';

type SectionState = 'idle' | 'loading' | 'refreshing' | 'error';

interface SectionLoadingStateProps {
    state: SectionState;
    children: ReactNode;
    errorMessage?: string | null;
    isSlow?: boolean;
    isStalled?: boolean;
    onRetry?: (() => void) | null;
    className?: string;
}

export default function SectionLoadingState({
    state,
    children,
    errorMessage = null,
    isSlow = false,
    isStalled = false,
    onRetry = null,
    className,
}: SectionLoadingStateProps) {
    const { t } = useI18n();

    return (
        <div className={joinClasses('space-y-3', className)}>
            {state === 'refreshing' && (
                <div className="flex justify-end">
                    <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 shadow-sm">
                        <span className="loading-dot-pulse h-2 w-2 rounded-full bg-blue-500" />
                        {t('section.loading.refreshing')}
                    </span>
                </div>
            )}
            {(state === 'loading' || state === 'refreshing') && isSlow && !isStalled && (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    {t('section.loading.slow')}
                </div>
            )}
            {(state === 'loading' || state === 'refreshing') && isStalled && (
                <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <span>{t('section.loading.stalled')}</span>
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="ml-3 rounded border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
                        >
                            {t('common.retry')}
                        </button>
                    )}
                </div>
            )}
            {state === 'error' && errorMessage && (
                <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    <span>{errorMessage}</span>
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="ml-3 rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                        >
                            {t('common.retry')}
                        </button>
                    )}
                </div>
            )}
            {children}
        </div>
    );
}

export type { SectionLoadingStateProps, SectionState };
