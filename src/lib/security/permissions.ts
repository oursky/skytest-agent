import { prisma } from '@/lib/core/prisma';
import type { TeamRole } from '@/types';

const TEAM_ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);
const TEAM_OWNER_ROLES = new Set(['OWNER']);

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

export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
    const membership = await prisma.teamMembership.findUnique({
        where: {
            teamId_userId: {
                teamId,
                userId,
            }
        },
        select: { id: true }
    });

    return membership !== null;
}

export async function isProjectMember(userId: string, projectId: string): Promise<boolean> {
    const teamId = await getProjectTeamId(projectId);
    if (!teamId) {
        return false;
    }

    return isTeamMember(userId, teamId);
}

export async function canManageProject(userId: string, projectId: string): Promise<boolean> {
    const teamId = await getProjectTeamId(projectId);
    if (!teamId) {
        return false;
    }

    const teamRole = await getTeamRole(userId, teamId);
    return teamRole !== null && TEAM_ADMIN_ROLES.has(teamRole);
}

export async function canCreateProject(userId: string, teamId: string): Promise<boolean> {
    const teamRole = await getTeamRole(userId, teamId);
    return teamRole !== null && TEAM_ADMIN_ROLES.has(teamRole);
}

export async function canDeleteTeam(userId: string, teamId: string): Promise<boolean> {
    const teamRole = await getTeamRole(userId, teamId);
    return teamRole !== null && TEAM_OWNER_ROLES.has(teamRole);
}

export async function canTransferTeamOwnership(userId: string, teamId: string): Promise<boolean> {
    const teamRole = await getTeamRole(userId, teamId);
    return teamRole !== null && TEAM_OWNER_ROLES.has(teamRole);
}

export async function canManageTeamMembers(userId: string, teamId: string): Promise<boolean> {
    const teamRole = await getTeamRole(userId, teamId);
    return teamRole !== null && TEAM_ADMIN_ROLES.has(teamRole);
}

export async function canManageTeamApiKey(userId: string, teamId: string): Promise<boolean> {
    const teamRole = await getTeamRole(userId, teamId);
    return teamRole !== null && TEAM_ADMIN_ROLES.has(teamRole);
}

export async function canRenameTeam(userId: string, teamId: string): Promise<boolean> {
    return canManageTeamMembers(userId, teamId);
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
    const teamId = await getProjectTeamId(projectId);
    if (!teamId) {
        return null;
    }

    return {
        teamId,
        teamRole: await getTeamRole(userId, teamId),
    };
}
