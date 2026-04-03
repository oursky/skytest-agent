'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useAuth } from '@/app/auth-provider';
import { persistCurrentTeamSelection } from '@/hooks/team/persist-current-team';
import {
    CURRENT_TEAM_CHANGED_EVENT,
    TEAMS_CHANGED_EVENT,
} from '@/hooks/team/team-session-events';
import type { CurrentTeam, TeamOption } from '@/hooks/team/types';

interface TeamSessionContextValue {
    teams: TeamOption[];
    currentTeam: CurrentTeam | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    setCurrentTeam: (teamId: string) => Promise<CurrentTeam>;
}

const TeamSessionContext = createContext<TeamSessionContextValue | null>(null);

interface TeamsBootstrapPayload {
    teams: TeamOption[];
    currentTeam: CurrentTeam | null;
}

export function TeamSessionProvider({ children }: { children: React.ReactNode }) {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const enabled = isLoggedIn && !isAuthLoading;

    const [teams, setTeams] = useState<TeamOption[]>([]);
    const [currentTeam, setCurrentTeamState] = useState<CurrentTeam | null>(null);
    const [loading, setLoading] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const latestRequestIdRef = useRef(0);

    const fetchSession = useCallback(async (teamIdOverride?: string) => {
        const requestId = ++latestRequestIdRef.current;

        if (!enabled) {
            setTeams([]);
            setCurrentTeamState(null);
            setLoading(false);
            setHasLoadedOnce(false);
            setError(null);
            return;
        }

        try {
            setLoading(true);
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

            const url = new URL('/api/teams/bootstrap', window.location.origin);
            if (teamIdOverride) {
                url.searchParams.set('teamId', teamIdOverride);
            }

            const response = await fetch(url.toString(), { headers });
            if (!response.ok) {
                throw new Error('Failed to fetch teams session payload');
            }

            const payload = await response.json() as TeamsBootstrapPayload;
            if (requestId !== latestRequestIdRef.current) {
                return;
            }

            setTeams(payload.teams);
            setCurrentTeamState(payload.currentTeam);
            setError(null);
        } catch (sessionError) {
            if (requestId !== latestRequestIdRef.current) {
                return;
            }

            console.error('Error fetching team session payload:', sessionError);
            setError('Failed to load team session data');
        } finally {
            if (requestId !== latestRequestIdRef.current) {
                return;
            }

            setLoading(false);
            setHasLoadedOnce(true);
        }
    }, [enabled, getAccessToken]);

    const persistCurrentTeam = useCallback(async (teamId: string) => {
        const payload = await persistCurrentTeamSelection(getAccessToken, teamId);
        setCurrentTeamState(payload);
        await fetchSession(teamId);
        return payload;
    }, [fetchSession, getAccessToken]);

    useEffect(() => {
        void fetchSession();
    }, [fetchSession]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleTeamsChanged = () => {
            void fetchSession();
        };

        const handleCurrentTeamChanged = (event: Event) => {
            const teamId = (event as CustomEvent<{ teamId?: string | null }>).detail?.teamId;
            void fetchSession(typeof teamId === 'string' ? teamId : undefined);
        };

        window.addEventListener(TEAMS_CHANGED_EVENT, handleTeamsChanged);
        window.addEventListener(CURRENT_TEAM_CHANGED_EVENT, handleCurrentTeamChanged);
        return () => {
            window.removeEventListener(TEAMS_CHANGED_EVENT, handleTeamsChanged);
            window.removeEventListener(CURRENT_TEAM_CHANGED_EVENT, handleCurrentTeamChanged);
        };
    }, [fetchSession]);

    const value = useMemo<TeamSessionContextValue>(() => ({
        teams,
        currentTeam,
        loading: loading || (enabled && !hasLoadedOnce),
        error,
        refresh: async () => {
            await fetchSession();
        },
        setCurrentTeam: persistCurrentTeam,
    }), [currentTeam, enabled, error, fetchSession, hasLoadedOnce, loading, persistCurrentTeam, teams]);

    return (
        <TeamSessionContext.Provider value={value}>
            {children}
        </TeamSessionContext.Provider>
    );
}

export function useTeamSession() {
    const context = useContext(TeamSessionContext);
    if (!context) {
        throw new Error('useTeamSession must be used within TeamSessionProvider');
    }

    return context;
}
