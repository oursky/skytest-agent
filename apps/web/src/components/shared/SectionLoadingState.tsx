'use client';

import type { ReactNode } from 'react';

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

function joinClasses(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
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
    return (
        <div className={joinClasses('space-y-3', className)}>
            {state === 'refreshing' && (
                <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    Refreshing data...
                </div>
            )}
            {(state === 'loading' || state === 'refreshing') && isSlow && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Still loading. Network latency may be high.
                </div>
            )}
            {(state === 'loading' || state === 'refreshing') && isStalled && (
                <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    <span>Loading is taking longer than expected.</span>
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="ml-3 rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                        >
                            Retry
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
                            Retry
                        </button>
                    )}
                </div>
            )}
            {children}
        </div>
    );
}

export type { SectionLoadingStateProps, SectionState };
