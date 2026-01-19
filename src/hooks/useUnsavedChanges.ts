'use client';

import { useEffect, useCallback } from 'react';

/**
 * Hook that handles the beforeunload event when form has unsaved changes.
 * Shows a browser confirmation dialog when the user tries to leave the page.
 *
 * @param isDirty - Whether the form has unsaved changes
 * @param message - Optional custom message (note: modern browsers typically ignore custom messages)
 */
export function useUnsavedChanges(isDirty: boolean, message?: string) {
    const handleBeforeUnload = useCallback((event: BeforeUnloadEvent) => {
        if (isDirty) {
            event.preventDefault();
            // Modern browsers ignore custom messages and show a generic message
            // but we set returnValue for legacy browser support
            event.returnValue = message || 'You have unsaved changes. Are you sure you want to leave?';
            return event.returnValue;
        }
    }, [isDirty, message]);

    useEffect(() => {
        if (isDirty) {
            window.addEventListener('beforeunload', handleBeforeUnload);
            return () => {
                window.removeEventListener('beforeunload', handleBeforeUnload);
            };
        }
    }, [isDirty, handleBeforeUnload]);
}
