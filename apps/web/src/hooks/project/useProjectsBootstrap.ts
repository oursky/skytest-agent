import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '@/types';
import { createRequestIdGuard } from '@/hooks/team/request-id-guard';
import { useTeamSession } from '@/hooks/team/useTeamSession';
import { reportLoadMetric } from '@/lib/telemetry/client-metrics';

export function shouldMarkProjectsBootstrapLoadedWithoutSelectedTeam(
    isTeamSessionLoading: boolean,
): boolean {
    return !isTeamSessionLoading;
}

export function useProjectsBootstrap(
    getAccessToken: () => Promise<string | null>,
    requestedTeamId: string,
    enabled = true,
) {
    const {
        teams,
        currentTeam,
        loading: isTeamSessionLoading,
        error: teamSessionError,
        refresh: refreshTeamSession,
        setCurrentTeam,
    } = useTeamSession();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hasLoadedOnceRef = useRef(false);
    const requestIdGuardRef = useRef(createRequestIdGuard());

    useEffect(() => {
        hasLoadedOnceRef.current = hasLoadedOnce;
    }, [hasLoadedOnce]);

    const fetchProjects = useCallback(async () => {
        const requestId = requestIdGuardRef.current.next();

        if (!enabled) {
            setLoadingProjects(false);
            setHasLoadedOnce(false);
            setProjects([]);
            setError(null);
            return;
        }

        const hasRequestedTeam = requestedTeamId.length > 0
            && teams.some((team) => team.id === requestedTeamId);

        if (hasRequestedTeam && currentTeam?.id !== requestedTeamId) {
            try {
                setLoadingProjects(true);
                setProjects([]);
                await setCurrentTeam(requestedTeamId);
            } catch {
                if (!requestIdGuardRef.current.isLatest(requestId)) {
                    return;
                }
                setError('Failed to switch team');
                setLoadingProjects(false);
                setHasLoadedOnce(true);
            }
            return;
        }

        const effectiveTeamId = currentTeam?.id ?? '';
        if (!effectiveTeamId) {
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return;
            }
            setProjects([]);
            setError(null);
            setLoadingProjects(false);
            if (shouldMarkProjectsBootstrapLoadedWithoutSelectedTeam(isTeamSessionLoading)) {
                setHasLoadedOnce(true);
            }
            return;
        }

        try {
            const requestStartedAt = performance.now();
            const wasRefreshRequest = hasLoadedOnceRef.current;
            setLoadingProjects(true);

            const token = await getAccessToken();
            const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
            const response = await fetch(`/api/projects?teamId=${encodeURIComponent(effectiveTeamId)}`, { headers });
            if (!response.ok) {
                throw new Error('Failed to fetch projects');
            }

            const payload = await response.json() as Project[];
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return;
            }

            setProjects(payload);
            setError(null);
            reportLoadMetric({
                elapsedMs: performance.now() - requestStartedAt,
                isRefreshRequest: wasRefreshRequest,
                context: 'projects-bootstrap',
            });
        } catch (projectsError) {
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return;
            }
            console.error('Error fetching projects payload:', projectsError);
            setError('Failed to load projects page data');
        } finally {
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return;
            }
            setLoadingProjects(false);
            setHasLoadedOnce(true);
        }
    }, [currentTeam?.id, enabled, getAccessToken, isTeamSessionLoading, requestedTeamId, setCurrentTeam, teams]);

    useEffect(() => {
        void fetchProjects();
    }, [fetchProjects]);

    const refresh = useCallback(async () => {
        await refreshTeamSession(requestedTeamId || undefined);
        await fetchProjects();
    }, [fetchProjects, refreshTeamSession, requestedTeamId]);

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
        loading: loadingProjects || isTeamSessionLoading || (enabled && !hasLoadedOnce),
        isInitialLoading: enabled && !hasLoadedOnce,
        hasLoadedOnce,
        error: error ?? teamSessionError,
        refresh,
        setCurrentTeam,
        addProject,
        removeProject,
    };
}
