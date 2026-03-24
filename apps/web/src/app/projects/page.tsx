"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth-provider";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, CenteredLoading, Modal } from "@/components/shared";
import { formatDateTime } from "@/utils/time/dateFormatter";
import { useProjectsBootstrap } from "@/hooks/project/useProjectsBootstrap";
import { useI18n } from "@/i18n";
import { useCreateTeam } from "@/hooks/team/useCreateTeam";

export default function ProjectsPage() {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { t } = useI18n();

    const requestedTeamId = searchParams.get('teamId')?.trim() || '';
    const isBootstrapEnabled = isLoggedIn && !isAuthLoading;
    const {
        teams,
        currentTeam: selectedTeam,
        projects,
        loading: isProjectsBootstrapLoading,
        refresh,
        setCurrentTeam,
        addProject,
        removeProject,
    } = useProjectsBootstrap(getAccessToken, requestedTeamId, isBootstrapEnabled);
    const refreshTeams = useCallback(async () => {
        await refresh();
    }, [refresh]);
    const { createTeam } = useCreateTeam({
        getAccessToken,
        refreshTeams,
        setCurrentTeam,
    });
    const effectiveTeamId = selectedTeam?.id || '';
    const currentTeam = teams.find((team) => team.id === effectiveTeamId) ?? null;
    const canManageProjects = currentTeam !== null;
    const canDeleteProjects = currentTeam?.role === 'OWNER';
    const [isCreating, setIsCreating] = useState(false);
    const [newProjectName, setNewProjectName] = useState("");
    const [newTeamName, setNewTeamName] = useState("");
    const [createError, setCreateError] = useState("");
    const [teamError, setTeamError] = useState("");
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; projectId: string; projectName: string }>({ isOpen: false, projectId: "", projectName: "" });
    const [editModal, setEditModal] = useState<{ isOpen: boolean; projectId: string; currentName: string }>({ isOpen: false, projectId: "", currentName: "" });
    const [editName, setEditName] = useState("");
    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        if (!isAuthLoading && isLoggedIn && !isProjectsBootstrapLoading && teams.length === 0 && !selectedTeam) {
            router.push('/welcome');
        }
    }, [isAuthLoading, isLoggedIn, isProjectsBootstrapLoading, teams.length, selectedTeam, router]);

    const handleCreateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        const teamId = effectiveTeamId;
        const trimmedProjectName = newProjectName.trim();
        if (!trimmedProjectName || !teamId) return;

        try {
            const token = await getAccessToken();
            const response = await fetch("/api/projects", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { "Authorization": `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ name: trimmedProjectName, teamId }),
            });

            if (response.ok) {
                const newProject = await response.json();
                addProject(newProject);
                setNewProjectName("");
                setIsCreating(false);
                setCreateError("");
            } else {
                const data = await response.json().catch(() => ({ error: t('projects.createError') }));
                setCreateError(data.error || t('projects.createError'));
            }
        } catch {
            setCreateError(t('projects.createError'));
        }
    };

    const handleCreateTeam = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTeamName.trim()) return;

        const result = await createTeam(newTeamName, t('projects.team.createError'));
        if (!result.teamId) {
            setTeamError(result.error || t('projects.team.createError'));
            return;
        }

        setNewTeamName('');
        setTeamError('');
    };

    const handleDeleteProject = async () => {
        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/projects/${deleteModal.projectId}`, {
                method: "DELETE",
                headers: {
                    ...(token ? { "Authorization": `Bearer ${token}` } : {})
                }
            });

            if (response.ok) {
                removeProject(deleteModal.projectId);
                setDeleteModal({ isOpen: false, projectId: "", projectName: "" });
            }
        } catch (error) {
            console.error("Failed to delete project", error);
        }
    };

    const handleEditProject = async () => {
        if (!editName.trim() || editName === editModal.currentName) return;

        try {
            const token = await getAccessToken();
            const response = await fetch(`/api/projects/${editModal.projectId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { "Authorization": `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ name: editName }),
            });

            if (response.ok) {
                await response.json();
                await refresh();
                setEditModal({ isOpen: false, projectId: "", currentName: "" });
            }
        } catch (error) {
            console.error("Failed to edit project", error);
        }
    };

    const closeEditModal = () => {
        setEditModal({ isOpen: false, projectId: "", currentName: "" });
        setEditName("");
    };

    const isPageLoading = isAuthLoading
        || (isLoggedIn && isProjectsBootstrapLoading);

    if (isPageLoading) {
        return <CenteredLoading className="h-[calc(100dvh-4.5rem)]" />;
    }

    return (
        <main className="min-h-[calc(100dvh-4.5rem)] bg-gray-50">
            <Modal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, projectId: "", projectName: "" })}
                title={t('projects.deleteProject.title')}
                onConfirm={handleDeleteProject}
                confirmText={t('projects.deleteProject.confirm')}
                confirmVariant="danger"
            >
                <p className="text-gray-700">
                    {t('projects.deleteProject.body', { name: deleteModal.projectName })}
                </p>
            </Modal>

            <Modal
                isOpen={editModal.isOpen}
                onClose={closeEditModal}
                title={t('projects.editProject.title')}
                onConfirm={handleEditProject}
                confirmText={t('projects.editProject.save')}
            >
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                        {t('projects.projectName')}
                    </label>
                    <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                        placeholder={t('projects.enterProjectName')}
                        autoFocus
                    />
                </div>
            </Modal>

            <Modal
                isOpen={isCreating && teams.length > 0 && canManageProjects}
                onClose={() => {
                    setIsCreating(false);
                    setNewProjectName("");
                    setCreateError("");
                }}
                title={t('projects.addProjectTitle')}
                closeOnConfirm={false}
                showFooter={false}
                panelClassName="max-w-lg"
            >
                <form onSubmit={handleCreateProject} className="space-y-4">
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-gray-700">{t('projects.projectName')}</span>
                        <input
                            type="text"
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder={t('projects.newProject.formPlaceholder')}
                            className="w-full rounded-md border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                            autoFocus
                        />
                    </label>
                    {createError && <p className="text-sm text-red-600">{createError}</p>}
                    <div className="flex justify-end gap-3 pt-4">
                        <Button
                            type="button"
                            onClick={() => {
                                setIsCreating(false);
                                setNewProjectName("");
                                setCreateError("");
                            }}
                            variant="secondary"
                            size="sm"
                        >
                            {t('projects.cancel')}
                        </Button>
                        <Button
                            type="submit"
                            disabled={!newProjectName.trim() || !effectiveTeamId}
                            variant="primary"
                            size="sm"
                        >
                            {t('projects.create')}
                        </Button>
                    </div>
                </form>
            </Modal>

            <div className="max-w-7xl mx-auto px-8 py-8">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">{t('projects.title')}</h1>
                    {teams.length > 0 && canManageProjects && (
                        <Button
                            onClick={() => setIsCreating(true)}
                            variant="primary"
                            size="sm"
                        >
                            {t('projects.newProject')}
                        </Button>
                    )}
                </div>

                {teams.length === 0 && !selectedTeam && (
                    <div className="mb-8 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                        <h2 className="text-xl font-semibold text-gray-900 mb-2">{t('projects.team.emptyTitle')}</h2>
                        <p className="text-sm text-gray-500 mb-4">{t('projects.team.emptySubtitle')}</p>
                        <form onSubmit={handleCreateTeam} className="flex gap-4">
                            <input
                                type="text"
                                value={newTeamName}
                                onChange={(e) => setNewTeamName(e.target.value)}
                                placeholder={t('projects.team.placeholder')}
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                            />
                            <Button
                                type="submit"
                                disabled={!newTeamName.trim()}
                                variant="primary"
                                size="sm"
                            >
                                {t('projects.team.create')}
                            </Button>
                        </form>
                        {teamError && <p className="text-red-500 text-sm mt-2">{teamError}</p>}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.map((project) => (
                        <div
                            key={project.id}
                            className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow group relative flex flex-col"
                        >
                            <div className="flex items-start justify-between mb-2">
                                <Link href={`/projects/${project.id}`} className="flex-1 min-w-0">
                                    <h2 className="text-xl font-semibold text-gray-900 group-hover:text-primary transition-colors truncate">
                                        {project.name}
                                    </h2>
                                </Link>
                                <div className="flex gap-2 ml-4 flex-shrink-0">
                                    {canManageProjects && (
                                        <>
                                            <button
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    setEditModal({ isOpen: true, projectId: project.id, currentName: project.name });
                                                    setEditName(project.name);
                                                }}
                                                className="p-2 text-gray-400 hover:text-primary transition-colors"
                                                title={t('projects.tooltip.edit')}
                                                aria-label={t('projects.tooltip.edit')}
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                            </button>
                                            {canDeleteProjects && (
                                                <button
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        setDeleteModal({ isOpen: true, projectId: project.id, projectName: project.name });
                                                    }}
                                                    disabled={project.hasActiveRuns}
                                                    className={`p-2 transition-colors ${project.hasActiveRuns
                                                        ? "text-gray-300 cursor-not-allowed"
                                                        : "text-gray-400 hover:text-red-600"
                                                        }`}
                                                    title={project.hasActiveRuns ? t('projects.tooltip.cannotDeleteRunning') : t('projects.tooltip.delete')}
                                                    aria-label={t('projects.tooltip.delete')}
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                            <Link href={`/projects/${project.id}`} className="block flex-1">
                                <p className="text-sm text-gray-500">
                                    {t('projects.testCasesCount', { count: project._count?.testCases || 0 })}
                                </p>
                                <p className="text-xs text-gray-400 mt-4">
                                    {t('projects.lastUpdated', { time: formatDateTime(project.updatedAt) })}
                                </p>
                            </Link>
                        </div>
                    ))}
                </div>

                {projects.length === 0 && !isCreating && teams.length > 0 && (
                    <div className="text-center py-16">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('projects.noProjects.title')}</h3>
                        <p className="text-gray-500 mb-6">{t('projects.noProjects.subtitle')}</p>
                        {canManageProjects && (
                            <Button
                                onClick={() => setIsCreating(true)}
                                variant="primary"
                                size="sm"
                                className="inline-flex items-center gap-2"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                </svg>
                                {t('projects.noProjects.create')}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </main>
    );
}
