import { useCallback } from 'react';
import type { Project } from '@/types';
import { useTeamScopedBootstrap } from '@/hooks/team/useTeamScopedBootstrap';
import { extractListData } from '@/utils/pagination/pagination';

const EMPTY_PROJECTS: Project[] = [];

export function useProjectsBootstrap(
    getAccessToken: () => Promise<string | null>,
    requestedTeamId: string,
    enabled = true,
) {
    const loadForTeam = useCallback(async ({ teamId, token }: { teamId: string; token: string | null }) => {
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await fetch(`/api/projects?teamId=${encodeURIComponent(teamId)}`, { headers });
        if (!response.ok) {
            throw new Error('Failed to fetch projects');
        }
        return extractListData<Project>(await response.json());
    }, []);

    const {
        teams,
        currentTeam,
        data: projects,
        setData: setProjects,
        loading,
        isInitialLoading,
        hasLoadedOnce,
        error,
        refresh,
        setCurrentTeam,
    } = useTeamScopedBootstrap<Project[]>({
        getAccessToken,
        requestedTeamId,
        enabled,
        emptyValue: EMPTY_PROJECTS,
        telemetryContext: 'projects-bootstrap',
        loadErrorMessage: 'Failed to load projects page data',
        loadForTeam,
    });

    const addProject = useCallback((newProject: Project) => {
        setProjects((previous) => [newProject, ...previous]);
    }, [setProjects]);

    const removeProject = useCallback((projectId: string) => {
        setProjects((previous) => previous.filter((project) => project.id !== projectId));
    }, [setProjects]);

    return {
        teams,
        currentTeam,
        projects,
        loading,
        isInitialLoading,
        hasLoadedOnce,
        error,
        refresh,
        setCurrentTeam,
        addProject,
        removeProject,
    };
}
