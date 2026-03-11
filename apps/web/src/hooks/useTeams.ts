import { useCallback, useEffect, useState } from 'react';

export interface TeamOption {
    id: string;
    name: string;
    role: 'OWNER' | 'MEMBER';
    createdAt: string;
    updatedAt: string;
}

const TEAMS_CHANGED_EVENT = 'skytest:teams-changed';

export function dispatchTeamsChanged() {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new CustomEvent(TEAMS_CHANGED_EVENT));
}

export function useTeams(
    getAccessToken?: () => Promise<string | null>,
    enabled = true
) {
    const [teams, setTeams] = useState<TeamOption[]>([]);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<string | null>(null);

    const fetchTeams = useCallback(async () => {
        if (!enabled) {
            setTeams([]);
            setLoading(false);
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
        loading,
        error,
        refresh: fetchTeams,
        setTeams,
    };
}
