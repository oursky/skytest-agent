import { useCallback, useEffect, useState } from 'react';
import { persistCurrentTeamSelection } from './persist-current-team';
import {
    CURRENT_TEAM_CHANGED_EVENT,
    dispatchCurrentTeamChanged,
} from './team-session-events';
import type { CurrentTeam } from './types';

export { dispatchCurrentTeamChanged };
export type { CurrentTeam } from './types';

export function useCurrentTeam(
    getAccessToken?: () => Promise<string | null>,
    enabled = true
) {
    const [currentTeam, setCurrentTeam] = useState<CurrentTeam | null>(null);
    const [loading, setLoading] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchCurrentTeam = useCallback(async () => {
        if (!enabled) {
            setLoading(false);
            setCurrentTeam(null);
            setHasLoadedOnce(false);
            return;
        }

        try {
            setLoading(true);
            const headers: HeadersInit = {};
            if (getAccessToken) {
                const token = await getAccessToken();
                if (token) {
                    headers.Authorization = `Bearer ${token}`;
                }
            }

            const response = await fetch('/api/teams/current', { headers });
            if (!response.ok) {
                throw new Error('Failed to fetch current team');
            }

            const data = await response.json() as CurrentTeam | { team: null };
            if ('team' in data) {
                setCurrentTeam(null);
            } else {
                setCurrentTeam(data);
            }
            setError(null);
        } catch (err) {
            console.error('Error fetching current team:', err);
            setCurrentTeam(null);
            setError('Failed to load current team');
        } finally {
            setLoading(false);
            setHasLoadedOnce(true);
        }
    }, [enabled, getAccessToken]);

    const persistCurrentTeam = useCallback(async (teamId: string) => {
        const data = await persistCurrentTeamSelection(getAccessToken, teamId);
        setCurrentTeam(data);
        setError(null);
        return data;
    }, [getAccessToken]);

    useEffect(() => {
        void fetchCurrentTeam();
    }, [fetchCurrentTeam]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleCurrentTeamChange = () => {
            void fetchCurrentTeam();
        };

        window.addEventListener(CURRENT_TEAM_CHANGED_EVENT, handleCurrentTeamChange);
        return () => {
            window.removeEventListener(CURRENT_TEAM_CHANGED_EVENT, handleCurrentTeamChange);
        };
    }, [fetchCurrentTeam]);

    return {
        currentTeam,
        loading: loading || (enabled && !hasLoadedOnce),
        error,
        refresh: fetchCurrentTeam,
        setCurrentTeam: persistCurrentTeam,
    };
}
