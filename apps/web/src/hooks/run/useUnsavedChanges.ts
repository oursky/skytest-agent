'use client';

import { useEffect, useCallback } from 'react';

/**
 * Hook that handles the beforeunload event when form has unsaved changes.
 * Shows a browser confirmation dialog when the user tries to leave the page.
 *
 * @param isDirty - Whether the form has unsaved changes
 */
export function useUnsavedChanges(isDirty: boolean) {
    const handleBeforeUnload = useCallback((event: BeforeUnloadEvent) => {
        if (isDirty) {
            event.preventDefault();
            // Modern browsers show a generic message.
            event.returnValue = '';
        }
    }, [isDirty]);

    useEffect(() => {
        if (isDirty) {
            window.addEventListener('beforeunload', handleBeforeUnload);
            return () => {
                window.removeEventListener('beforeunload', handleBeforeUnload);
            };
        }
    }, [isDirty, handleBeforeUnload]);
}
