"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../auth-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import { formatDateTime } from "@/utils/dateFormatter";
import { useProjects } from "@/hooks/useProjects";
import { Project } from "@/types";

export default function ProjectsPage() {
    const { user, isLoggedIn, isLoading: isAuthLoading } = useAuth();
    const router = useRouter();
    const { projects, loading: isLoading, error, addProject, removeProject, updateProject, refresh } = useProjects(user?.sub || '');
    const [isCreating, setIsCreating] = useState(false);
    const [newProjectName, setNewProjectName] = useState("");
    const [createError, setCreateError] = useState("");
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; projectId: string; projectName: string }>({ isOpen: false, projectId: "", projectName: "" });
    const [editModal, setEditModal] = useState<{ isOpen: boolean; projectId: string; currentName: string }>({ isOpen: false, projectId: "", currentName: "" });
    const [editName, setEditName] = useState("");

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    const handleCreateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProjectName.trim() || !user?.sub) return;

        try {
            const response = await fetch("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newProjectName, userId: user.sub }),
            });

            if (response.ok) {
                const newProject = await response.json();
                addProject(newProject);
                setNewProjectName("");
                setIsCreating(false);
                setCreateError("");
            } else {
                setCreateError("Failed to create project");
            }
        } catch (error) {
            setCreateError("Failed to create project");
        }
    };

    const handleDeleteProject = async () => {
        try {
            const response = await fetch(`/api/projects/${deleteModal.projectId}`, {
                method: "DELETE",
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
            const response = await fetch(`/api/projects/${editModal.projectId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: editName }),
            });

            if (response.ok) {
                const updatedProject = await response.json();
                refresh();
                setEditModal({ isOpen: false, projectId: "", currentName: "" });
            }
        } catch (error) {
            console.error("Failed to edit project", error);
        }
    };

    if (isAuthLoading || isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <Modal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, projectId: "", projectName: "" })}
                title="Delete Project"
                onConfirm={handleDeleteProject}
                confirmText="Delete"
                confirmVariant="danger"
            >
                <p className="text-gray-700">
                    Are you sure you want to delete <span className="font-semibold">{deleteModal.projectName}</span>? This will permanently delete all test cases in this project.
                </p>
            </Modal>

            <Modal
                isOpen={editModal.isOpen}
                onClose={() => {
                    setEditModal({ isOpen: false, projectId: "", currentName: "" });
                    setEditName("");
                }}
                title="Edit Project Name"
                onConfirm={handleEditProject}
                confirmText="Save"
            >
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                        Project Name
                    </label>
                    <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                        placeholder="Enter project name"
                        autoFocus
                    />
                </div>
            </Modal>

            <div className="max-w-5xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Projects</h1>
                    <button
                        onClick={() => setIsCreating(true)}
                        className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
                    >
                        New Project
                    </button>
                </div>

                {isCreating && (
                    <div className="mb-8 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                        <form onSubmit={handleCreateProject} className="flex gap-4">
                            <input
                                type="text"
                                value={newProjectName}
                                onChange={(e) => setNewProjectName(e.target.value)}
                                placeholder="Project Name"
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                                autoFocus
                            />
                            <button
                                type="submit"
                                disabled={!newProjectName.trim()}
                                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                            >
                                Create
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsCreating(false)}
                                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                            >
                                Cancel
                            </button>
                        </form>
                        {createError && <p className="text-red-500 text-sm mt-2">{createError}</p>}
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
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            setEditModal({ isOpen: true, projectId: project.id, currentName: project.name });
                                            setEditName(project.name);
                                        }}
                                        className="p-2 text-gray-400 hover:text-primary transition-colors"
                                        title="Edit Project"
                                        aria-label="Edit Project"
                                    >
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                    </button>
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
                                        title={project.hasActiveRuns ? "Cannot delete project with running tests" : "Delete Project"}
                                        aria-label="Delete Project"
                                    >
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <Link href={`/projects/${project.id}`} className="block flex-1">
                                <p className="text-sm text-gray-500">
                                    {project._count?.testCases || 0} Test Cases
                                </p>
                                <p className="text-xs text-gray-400 mt-4">
                                    Last updated: {formatDateTime(project.updatedAt)}
                                </p>
                            </Link>
                        </div>
                    ))}
                </div>

                {projects.length === 0 && !isCreating && (
                    <div className="text-center py-16">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">No projects yet</h3>
                        <p className="text-gray-500 mb-6">Get started by creating your first project to organize your test cases.</p>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                            Create Project
                        </button>
                    </div>
                )}
            </div>
        </main >
    );
}
