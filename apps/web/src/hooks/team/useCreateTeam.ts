'use client';

import { useCallback, useState } from 'react';
import { dispatchTeamsChanged } from './useTeams';

interface UseCreateTeamOptions {
    getAccessToken: () => Promise<string | null>;
    refreshTeams: () => Promise<void>;
    setCurrentTeam: (teamId: string) => Promise<unknown>;
}

interface CreateTeamResult {
    teamId: string | null;
    error: string | null;
}

export function useCreateTeam({
    getAccessToken,
    refreshTeams,
    setCurrentTeam,
}: UseCreateTeamOptions) {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const createTeam = useCallback(async (name: string, fallbackError: string): Promise<CreateTeamResult> => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            return { teamId: null, error: fallbackError };
        }

        setIsSubmitting(true);
        try {
            const token = await getAccessToken();
            const response = await fetch('/api/teams', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ name: trimmedName }),
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload || typeof payload.id !== 'string') {
                return {
                    teamId: null,
                    error: payload && typeof payload.error === 'string' ? payload.error : fallbackError,
                };
            }

            dispatchTeamsChanged();
            await refreshTeams();
            await setCurrentTeam(payload.id);
            return { teamId: payload.id, error: null };
        } catch {
            return { teamId: null, error: fallbackError };
        } finally {
            setIsSubmitting(false);
        }
    }, [getAccessToken, refreshTeams, setCurrentTeam]);

    return {
        createTeam,
        isSubmitting,
    };
}

export type { CreateTeamResult, UseCreateTeamOptions };
