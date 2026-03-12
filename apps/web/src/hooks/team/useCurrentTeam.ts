import { useCallback, useEffect, useState } from 'react';

export interface CurrentTeam {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}

const CURRENT_TEAM_EVENT = 'skytest:current-team-changed';

export function dispatchCurrentTeamChanged(teamId: string | null) {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new CustomEvent(CURRENT_TEAM_EVENT, {
        detail: { teamId }
    }));
}

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
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };

        if (getAccessToken) {
            const token = await getAccessToken();
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }
        }

        const response = await fetch('/api/teams/current', {
            method: 'POST',
            headers,
            body: JSON.stringify({ teamId }),
        });

        if (!response.ok) {
            throw new Error('Failed to persist current team');
        }

        const data = await response.json() as CurrentTeam;
        setCurrentTeam(data);
        setError(null);
        dispatchCurrentTeamChanged(data.id);
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

        window.addEventListener(CURRENT_TEAM_EVENT, handleCurrentTeamChange);
        return () => {
            window.removeEventListener(CURRENT_TEAM_EVENT, handleCurrentTeamChange);
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
