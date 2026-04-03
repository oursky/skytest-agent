'use client';

import { useCallback, useState } from 'react';
import { useTeamSession } from './useTeamSession';

interface CreateTeamResult {
    teamId: string | null;
    error: string | null;
}

export function useCreateTeam() {
    const { createTeam: createTeamInSession } = useTeamSession();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const createTeam = useCallback(async (name: string, fallbackError: string): Promise<CreateTeamResult> => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            return { teamId: null, error: fallbackError };
        }

        setIsSubmitting(true);
        try {
            const result = await createTeamInSession(trimmedName);
            return { teamId: result.teamId, error: null };
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : fallbackError;
            return { teamId: null, error: message };
        } finally {
            setIsSubmitting(false);
        }
    }, [createTeamInSession]);

    return {
        createTeam,
        isSubmitting,
    };
}

export type { CreateTeamResult };
