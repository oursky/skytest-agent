"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../auth-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Project {
    id: string;
    name: string;
    updatedAt: string;
    _count: {
        testCases: number;
    };
}

export default function ProjectsPage() {
    const { user, isLoggedIn, isLoading: isAuthLoading } = useAuth();
    const router = useRouter();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [newProjectName, setNewProjectName] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        if (!isAuthLoading && !isLoggedIn) {
            router.push("/");
        }
    }, [isAuthLoading, isLoggedIn, router]);

    useEffect(() => {
        if (user?.sub) {
            fetchProjects();
        }
    }, [user?.sub]);

    const fetchProjects = async () => {
        try {
            const response = await fetch(`/api/projects?userId=${user?.sub}`);
            if (response.ok) {
                const data = await response.json();
                setProjects(data);
            }
        } catch (error) {
            console.error("Failed to fetch projects", error);
        } finally {
            setIsLoading(false);
        }
    };

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
                setNewProjectName("");
                setIsCreating(false);
                fetchProjects();
            } else {
                setError("Failed to create project");
            }
        } catch (error) {
            setError("Failed to create project");
        }
    };

    const handleDeleteProject = async (id: string) => {
        if (!confirm("Are you sure? This will delete all test cases in this project.")) return;

        try {
            const response = await fetch(`/api/projects/${id}`, {
                method: "DELETE",
            });

            if (response.ok) {
                fetchProjects();
            }
        } catch (error) {
            console.error("Failed to delete project", error);
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
                        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.map((project) => (
                        <div
                            key={project.id}
                            className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow group relative"
                        >
                            <Link href={`/projects/${project.id}`} className="block">
                                <h2 className="text-xl font-semibold text-gray-900 mb-2 group-hover:text-primary transition-colors">
                                    {project.name}
                                </h2>
                                <p className="text-sm text-gray-500">
                                    {project._count.testCases} Test Cases
                                </p>
                                <p className="text-xs text-gray-400 mt-4">
                                    Last updated: {new Date(project.updatedAt).toLocaleDateString()}
                                </p>
                            </Link>
                            <button
                                onClick={(e) => {
                                    e.preventDefault();
                                    handleDeleteProject(project.id);
                                }}
                                className="absolute top-4 right-4 p-2 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete Project"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>

                {projects.length === 0 && !isCreating && (
                    <div className="text-center py-12">
                        <p className="text-gray-500 text-lg">No projects yet. Create one to get started!</p>
                    </div>
                )}
            </div>
        </main>
    );
}
