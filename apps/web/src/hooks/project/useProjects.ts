import { useState, useEffect, useCallback } from 'react';
import { Project } from '@/types';

const PROJECTS_API_ENDPOINT = '/api/projects';

export function useProjects(
    getAccessToken?: () => Promise<string | null>,
    teamId?: string,
    enabled = true
) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchProjects = useCallback(async () => {
        if (!enabled) {
            setProjects([]);
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
                    headers['Authorization'] = `Bearer ${token}`;
                }
            }

            const url = new URL(PROJECTS_API_ENDPOINT, window.location.origin);
            if (teamId) {
                url.searchParams.set('teamId', teamId);
            }

            const response = await fetch(url.toString(), {
                headers
            });

            if (!response.ok) {
                throw new Error('Failed to fetch projects');
            }
            const data = await response.json();
            setProjects(data);
            setError(null);
        } catch (err) {
            console.error('Error fetching projects:', err);
            setError('Failed to load projects');
        } finally {
            setLoading(false);
            setHasLoadedOnce(true);
        }
    }, [enabled, getAccessToken, teamId]);

    useEffect(() => {
        void fetchProjects();
    }, [fetchProjects]);

    const refresh = () => {
        fetchProjects();
    };

    const addProject = (newProject: Project) => {
        setProjects(prev => [newProject, ...prev]);
    };

    const removeProject = (projectId: string) => {
        setProjects(prev => prev.filter(p => p.id !== projectId));
    };

    const updateProject = (updatedProject: Project) => {
        setProjects(prev => prev.map(p => p.id === updatedProject.id ? updatedProject : p));
    };

    return {
        projects,
        loading: loading || (enabled && !hasLoadedOnce),
        error,
        refresh,
        addProject,
        removeProject,
        updateProject
    };
}
