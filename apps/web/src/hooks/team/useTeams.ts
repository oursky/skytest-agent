import { useCallback, useEffect, useState } from 'react';
import type { TeamOption } from './types';
import {
    dispatchTeamsChanged,
    TEAMS_CHANGED_EVENT,
} from './team-session-events';

export { dispatchTeamsChanged };
export type { TeamOption } from './types';

export function useTeams(
    getAccessToken?: () => Promise<string | null>,
    enabled = true
) {
    const [teams, setTeams] = useState<TeamOption[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchTeams = useCallback(async () => {
        if (!enabled) {
            setTeams([]);
            setLoading(false);
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

            const response = await fetch('/api/teams', { headers });
            if (!response.ok) {
                throw new Error('Failed to fetch teams');
            }

            const data = await response.json() as TeamOption[];
            setTeams(data);
            setError(null);
        } catch (err) {
            console.error('Error fetching teams:', err);
            setError('Failed to load teams');
        } finally {
            setLoading(false);
            setHasLoadedOnce(true);
        }
    }, [enabled, getAccessToken]);

    useEffect(() => {
        void fetchTeams();
    }, [fetchTeams]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleTeamsChanged = () => {
            void fetchTeams();
        };

        window.addEventListener(TEAMS_CHANGED_EVENT, handleTeamsChanged);
        return () => {
            window.removeEventListener(TEAMS_CHANGED_EVENT, handleTeamsChanged);
        };
    }, [fetchTeams]);

    return {
        teams,
        loading: loading || (enabled && !hasLoadedOnce),
        error,
        refresh: fetchTeams,
        setTeams,
    };
}
