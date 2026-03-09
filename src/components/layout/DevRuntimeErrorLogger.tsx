'use client';

import { useEffect } from 'react';
import { describeRuntimeErrorValue } from '@/lib/core/runtime-error-descriptor';

interface RuntimeLogEnvelope {
    source: 'window.error' | 'window.unhandledrejection';
    at: string;
    summary: string;
    detail: Record<string, string | number | boolean | null>;
}

function logRuntimeError(envelope: RuntimeLogEnvelope): void {
    console.error('[runtime-debug]', envelope);
}

export function DevRuntimeErrorLogger() {
    useEffect(() => {
        if (process.env.NODE_ENV !== 'development') {
            return;
        }

        const handleWindowError = (event: ErrorEvent) => {
            const descriptor = describeRuntimeErrorValue(event.error ?? event);
            logRuntimeError({
                source: 'window.error',
                at: new Date().toISOString(),
                summary: descriptor.summary,
                detail: {
                    ...descriptor.detail,
                    filename: event.filename || null,
                    lineno: event.lineno || null,
                    colno: event.colno || null,
                },
            });
        };

        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            const descriptor = describeRuntimeErrorValue(event.reason);
            logRuntimeError({
                source: 'window.unhandledrejection',
                at: new Date().toISOString(),
                summary: descriptor.summary,
                detail: descriptor.detail,
            });
        };

        window.addEventListener('error', handleWindowError);
        window.addEventListener('unhandledrejection', handleUnhandledRejection);

        return () => {
            window.removeEventListener('error', handleWindowError);
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
        };
    }, []);

    return null;
}
