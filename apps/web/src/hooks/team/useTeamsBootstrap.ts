import { useCallback } from 'react';
import { useTeamScopedBootstrap } from '@/hooks/team/useTeamScopedBootstrap';

export interface TeamDetailsBootstrap {
    id: string;
    name: string;
    role: 'OWNER' | 'MEMBER';
    canRename: boolean;
    canDelete: boolean;
    canTransferOwnership: boolean;
}

export interface TeamMemberBootstrap {
    id: string;
    userId: string | null;
    email: string | null;
    role: 'OWNER' | 'MEMBER';
}

interface TeamMembersResponse {
    members: TeamMemberBootstrap[];
}

interface TeamPageData {
    teamDetails: TeamDetailsBootstrap | null;
    members: TeamMemberBootstrap[];
}

const EMPTY_TEAM_PAGE_DATA: TeamPageData = { teamDetails: null, members: [] };

export function useTeamsBootstrap(
    getAccessToken: () => Promise<string | null>,
    requestedTeamId: string,
    enabled = true,
) {
    const loadForTeam = useCallback(async ({ teamId, token }: { teamId: string; token: string | null }): Promise<TeamPageData> => {
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

        const [teamResponse, membersResponse] = await Promise.all([
            fetch(`/api/teams/${encodeURIComponent(teamId)}`, { headers }),
            fetch(`/api/teams/${encodeURIComponent(teamId)}/members`, { headers }),
        ]);

        if (!teamResponse.ok) {
            throw new Error('Failed to fetch team details');
        }
        if (!membersResponse.ok) {
            throw new Error('Failed to fetch team members');
        }

        const teamPayload = await teamResponse.json() as TeamDetailsBootstrap;
        const membersPayload = await membersResponse.json() as TeamMembersResponse;

        return {
            teamDetails: {
                id: teamPayload.id,
                name: teamPayload.name,
                role: teamPayload.role,
                canRename: teamPayload.canRename,
                canDelete: teamPayload.canDelete,
                canTransferOwnership: teamPayload.canTransferOwnership,
            },
            members: membersPayload.members.map((member) => ({
                id: member.id,
                userId: member.userId,
                email: member.email,
                role: member.role,
            })),
        };
    }, []);

    const {
        teams,
        currentTeam,
        data,
        loading,
        isInitialLoading,
        hasLoadedOnce,
        error,
        refresh,
        setCurrentTeam,
    } = useTeamScopedBootstrap<TeamPageData>({
        getAccessToken,
        requestedTeamId,
        enabled,
        emptyValue: EMPTY_TEAM_PAGE_DATA,
        telemetryContext: 'teams-bootstrap',
        loadErrorMessage: 'Failed to load teams page data',
        loadForTeam,
    });

    return {
        teams,
        currentTeam,
        teamDetails: data.teamDetails,
        members: data.members,
        loading,
        isInitialLoading,
        hasLoadedOnce,
        error,
        refresh,
        setCurrentTeam,
    };
}
