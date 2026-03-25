import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '@/types';
import type { TeamOption } from '@/hooks/team/useTeams';
import type { CurrentTeam } from '@/hooks/team/useCurrentTeam';
import { rateDurationMetric, reportClientMetric } from '@/lib/telemetry/client-metrics';

const TEAMS_CHANGED_EVENT = 'skytest:teams-changed';
const CURRENT_TEAM_EVENT = 'skytest:current-team-changed';

interface ProjectsBootstrapPayload {
    teams: TeamOption[];
    currentTeam: CurrentTeam | null;
    projects: Project[];
}

function getRequestedTeamId(teamId: string | undefined, fallbackTeamId: string): string {
    if (teamId && teamId.length > 0) {
        return teamId;
    }
    return fallbackTeamId;
}

export function useProjectsBootstrap(
    getAccessToken: () => Promise<string | null>,
    requestedTeamId: string,
    enabled = true,
) {
    const [teams, setTeams] = useState<TeamOption[]>([]);
    const [currentTeam, setCurrentTeam] = useState<CurrentTeam | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
    const hasLoadedOnceRef = useRef(false);

    useEffect(() => {
        hasLoadedOnceRef.current = hasLoadedOnce;
    }, [hasLoadedOnce]);

    const fetchBootstrap = useCallback(async (teamIdOverride?: string) => {
        if (!enabled) {
            setLoading(false);
            setHasLoadedOnce(false);
            setTeams([]);
            setCurrentTeam(null);
            setProjects([]);
            setError(null);
            setLastUpdatedAt(null);
            return;
        }

        try {
            const requestStartedAt = performance.now();
            const wasRefreshRequest = hasLoadedOnceRef.current;
            setLoading(true);

            const token = await getAccessToken();
            const headers: HeadersInit = {};
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            const url = new URL('/api/projects/bootstrap', window.location.origin);
            const teamId = getRequestedTeamId(teamIdOverride, requestedTeamId);
            if (teamId) {
                url.searchParams.set('teamId', teamId);
            }

            const response = await fetch(url.toString(), { headers });
            if (!response.ok) {
                throw new Error('Failed to fetch projects bootstrap payload');
            }

            const payload = await response.json() as ProjectsBootstrapPayload;
            setTeams(payload.teams);
            setCurrentTeam(payload.currentTeam);
            setProjects(payload.projects);
            setError(null);
            setLastUpdatedAt(Date.now());
            const elapsedMs = Math.max(0, performance.now() - requestStartedAt);
            reportClientMetric({
                name: wasRefreshRequest ? 'LOAD_REFRESH_VISIBLE' : 'LOAD_DATA_READY',
                value: elapsedMs,
                rating: rateDurationMetric(elapsedMs),
            });
            if (elapsedMs >= 1_500) {
                reportClientMetric({
                    name: 'LOAD_SLOW_WARNING',
                    value: elapsedMs,
                    rating: elapsedMs >= 3_000 ? 'poor' : 'needs-improvement',
                });
                console.warn('[projects-bootstrap] slow load detected', { elapsedMs });
            }
        } catch (bootstrapError) {
            console.error('Error fetching projects bootstrap payload:', bootstrapError);
            setError('Failed to load projects page data');
        } finally {
            setLoading(false);
            setHasLoadedOnce(true);
        }
    }, [enabled, getAccessToken, requestedTeamId]);

    const persistCurrentTeam = useCallback(async (teamId: string) => {
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };

        const token = await getAccessToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch('/api/teams/current', {
            method: 'POST',
            headers,
            body: JSON.stringify({ teamId }),
        });

        if (!response.ok) {
            throw new Error('Failed to persist current team');
        }

        const payload = await response.json() as CurrentTeam;
        setCurrentTeam(payload);
        await fetchBootstrap(teamId);
        return payload;
    }, [fetchBootstrap, getAccessToken]);

    useEffect(() => {
        void fetchBootstrap();
    }, [fetchBootstrap]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleTeamsChanged = () => {
            void fetchBootstrap();
        };

        const handleCurrentTeamChanged = (event: Event) => {
            const teamId = (event as CustomEvent<{ teamId?: string | null }>).detail?.teamId;
            void fetchBootstrap(typeof teamId === 'string' ? teamId : undefined);
        };

        window.addEventListener(TEAMS_CHANGED_EVENT, handleTeamsChanged);
        window.addEventListener(CURRENT_TEAM_EVENT, handleCurrentTeamChanged);
        return () => {
            window.removeEventListener(TEAMS_CHANGED_EVENT, handleTeamsChanged);
            window.removeEventListener(CURRENT_TEAM_EVENT, handleCurrentTeamChanged);
        };
    }, [fetchBootstrap]);

    const refresh = useCallback(async () => {
        await fetchBootstrap();
    }, [fetchBootstrap]);

    const addProject = useCallback((newProject: Project) => {
        setProjects((previous) => [newProject, ...previous]);
    }, []);

    const removeProject = useCallback((projectId: string) => {
        setProjects((previous) => previous.filter((project) => project.id !== projectId));
    }, []);

    return {
        teams,
        currentTeam,
        projects,
        // Keep initial loading true before the first bootstrap fetch resolves.
        loading: loading || (enabled && !hasLoadedOnce),
        isInitialLoading: enabled && !hasLoadedOnce,
        isRefreshing: enabled && hasLoadedOnce && loading,
        hasLoadedOnce,
        lastUpdatedAt,
        error,
        refresh,
        setCurrentTeam: persistCurrentTeam,
        addProject,
        removeProject,
    };
}
