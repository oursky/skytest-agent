import { prisma } from '@/lib/core/prisma';
import type { TeamRole } from '@/types';

interface TeamCapabilities {
    canManageProjects: boolean;
    canManageMembers: boolean;
    canManageApiKey: boolean;
    canRenameTeam: boolean;
    canDeleteTeam: boolean;
    canTransferOwnership: boolean;
}

export interface TeamAccess extends TeamCapabilities {
    teamId: string;
    role: TeamRole | null;
    isMember: boolean;
}

export interface ProjectAccess extends TeamCapabilities {
    projectId: string;
    teamId: string | null;
    role: TeamRole | null;
    isMember: boolean;
}

const DEFAULT_CAPABILITIES: TeamCapabilities = {
    canManageProjects: false,
    canManageMembers: false,
    canManageApiKey: false,
    canRenameTeam: false,
    canDeleteTeam: false,
    canTransferOwnership: false,
};

const TEAM_ROLE_CAPABILITIES: Record<TeamRole, TeamCapabilities> = {
    OWNER: {
        canManageProjects: true,
        canManageMembers: true,
        canManageApiKey: true,
        canRenameTeam: true,
        canDeleteTeam: true,
        canTransferOwnership: true,
    },
    ADMIN: {
        canManageProjects: true,
        canManageMembers: true,
        canManageApiKey: true,
        canRenameTeam: true,
        canDeleteTeam: false,
        canTransferOwnership: false,
    },
    MEMBER: {
        canManageProjects: false,
        canManageMembers: false,
        canManageApiKey: false,
        canRenameTeam: false,
        canDeleteTeam: false,
        canTransferOwnership: false,
    },
};

async function getProjectTeamId(projectId: string): Promise<string | null> {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { teamId: true }
    });

    return project?.teamId ?? null;
}

async function getTestCaseProjectId(testCaseId: string): Promise<string | null> {
    const testCase = await prisma.testCase.findUnique({
        where: { id: testCaseId },
        select: { projectId: true }
    });

    return testCase?.projectId ?? null;
}

async function getTestRunProjectId(testRunId: string): Promise<string | null> {
    const testRun = await prisma.testRun.findUnique({
        where: { id: testRunId },
        select: {
            testCase: {
                select: {
                    projectId: true,
                }
            }
        }
    });

    return testRun?.testCase.projectId ?? null;
}

export async function getTeamRole(userId: string, teamId: string): Promise<TeamRole | null> {
    const membership = await prisma.teamMembership.findUnique({
        where: {
            teamId_userId: {
                teamId,
                userId,
            }
        },
        select: { role: true }
    });

    return membership?.role ?? null;
}

export async function getTeamAccess(userId: string, teamId: string): Promise<TeamAccess> {
    const role = await getTeamRole(userId, teamId);
    const capabilities = role ? TEAM_ROLE_CAPABILITIES[role] : DEFAULT_CAPABILITIES;

    return {
        teamId,
        role,
        isMember: role !== null,
        ...capabilities,
    };
}

export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
    const access = await getTeamAccess(userId, teamId);
    return access.isMember;
}

export async function isProjectMember(userId: string, projectId: string): Promise<boolean> {
    const teamId = await getProjectTeamId(projectId);
    if (!teamId) {
        return false;
    }

    return isTeamMember(userId, teamId);
}

export async function canManageProject(userId: string, projectId: string): Promise<boolean> {
    const access = await getProjectAccess(userId, projectId);
    return access.canManageProjects;
}

export async function canCreateProject(userId: string, teamId: string): Promise<boolean> {
    const access = await getTeamAccess(userId, teamId);
    return access.canManageProjects;
}

export async function canDeleteTeam(userId: string, teamId: string): Promise<boolean> {
    const access = await getTeamAccess(userId, teamId);
    return access.canDeleteTeam;
}

export async function canTransferTeamOwnership(userId: string, teamId: string): Promise<boolean> {
    const access = await getTeamAccess(userId, teamId);
    return access.canTransferOwnership;
}

export async function canManageTeamMembers(userId: string, teamId: string): Promise<boolean> {
    const access = await getTeamAccess(userId, teamId);
    return access.canManageMembers;
}

export async function canManageTeamApiKey(userId: string, teamId: string): Promise<boolean> {
    const access = await getTeamAccess(userId, teamId);
    return access.canManageApiKey;
}

export async function canRenameTeam(userId: string, teamId: string): Promise<boolean> {
    const access = await getTeamAccess(userId, teamId);
    return access.canRenameTeam;
}

export async function isTestCaseProjectMember(userId: string, testCaseId: string): Promise<boolean> {
    const projectId = await getTestCaseProjectId(testCaseId);
    if (!projectId) {
        return false;
    }

    return isProjectMember(userId, projectId);
}

export async function isTestRunProjectMember(userId: string, testRunId: string): Promise<boolean> {
    const projectId = await getTestRunProjectId(testRunId);
    if (!projectId) {
        return false;
    }

    return isProjectMember(userId, projectId);
}

export async function getProjectTeamMembership(
    userId: string,
    projectId: string
): Promise<{ teamId: string; teamRole: TeamRole | null } | null> {
    const access = await getProjectAccess(userId, projectId);
    if (!access.teamId) {
        return null;
    }

    return {
        teamId: access.teamId,
        teamRole: access.role,
    };
}

export async function getProjectAccess(userId: string, projectId: string): Promise<ProjectAccess> {
    const teamId = await getProjectTeamId(projectId);
    if (!teamId) {
        return {
            projectId,
            teamId: null,
            role: null,
            isMember: false,
            ...DEFAULT_CAPABILITIES,
        };
    }

    const access = await getTeamAccess(userId, teamId);

    return {
        projectId,
        teamId,
        role: access.role,
        isMember: access.isMember,
        canManageProjects: access.canManageProjects,
        canManageMembers: access.canManageMembers,
        canManageApiKey: access.canManageApiKey,
        canRenameTeam: access.canRenameTeam,
        canDeleteTeam: access.canDeleteTeam,
        canTransferOwnership: access.canTransferOwnership,
    };
}
