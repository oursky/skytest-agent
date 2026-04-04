import { useCallback, useEffect, useRef, useState } from 'react';
import { createRequestIdGuard } from '@/hooks/team/request-id-guard';
import { useTeamSession } from '@/hooks/team/useTeamSession';
import { reportLoadMetric } from '@/lib/telemetry/client-metrics';

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

interface TeamDetailsResponse {
    id: string;
    name: string;
    role: 'OWNER' | 'MEMBER';
    canRename: boolean;
    canDelete: boolean;
    canTransferOwnership: boolean;
}

interface TeamMembersResponse {
    members: Array<{
        id: string;
        userId: string | null;
        email: string | null;
        role: 'OWNER' | 'MEMBER';
    }>;
}

export function useTeamsBootstrap(
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
    const [teamDetails, setTeamDetails] = useState<TeamDetailsBootstrap | null>(null);
    const [members, setMembers] = useState<TeamMemberBootstrap[]>([]);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hasLoadedOnceRef = useRef(false);
    const requestIdGuardRef = useRef(createRequestIdGuard());

    useEffect(() => {
        hasLoadedOnceRef.current = hasLoadedOnce;
    }, [hasLoadedOnce]);

    const fetchTeamData = useCallback(async () => {
        const requestId = requestIdGuardRef.current.next();

        if (!enabled) {
            setTeamDetails(null);
            setMembers([]);
            setLoadingDetails(false);
            setHasLoadedOnce(false);
            setError(null);
            return;
        }

        const hasRequestedTeam = requestedTeamId.length > 0
            && teams.some((team) => team.id === requestedTeamId);

        if (hasRequestedTeam && currentTeam?.id !== requestedTeamId) {
            try {
                await setCurrentTeam(requestedTeamId);
            } catch {
                if (!requestIdGuardRef.current.isLatest(requestId)) {
                    return;
                }
                setError('Failed to switch team');
                setHasLoadedOnce(true);
            }
            return;
        }

        if (!currentTeam) {
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return;
            }
            setTeamDetails(null);
            setMembers([]);
            setError(null);
            setLoadingDetails(false);
            setHasLoadedOnce(true);
            return;
        }

        try {
            const requestStartedAt = performance.now();
            const wasRefreshRequest = hasLoadedOnceRef.current;
            setLoadingDetails(true);
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

            const [teamResponse, membersResponse] = await Promise.all([
                fetch(`/api/teams/${encodeURIComponent(currentTeam.id)}`, { headers }),
                fetch(`/api/teams/${encodeURIComponent(currentTeam.id)}/members`, { headers }),
            ]);

            if (!teamResponse.ok) {
                throw new Error('Failed to fetch team details');
            }
            if (!membersResponse.ok) {
                throw new Error('Failed to fetch team members');
            }

            const teamPayload = await teamResponse.json() as TeamDetailsResponse;
            const membersPayload = await membersResponse.json() as TeamMembersResponse;

            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return;
            }

            setTeamDetails({
                id: teamPayload.id,
                name: teamPayload.name,
                role: teamPayload.role,
                canRename: teamPayload.canRename,
                canDelete: teamPayload.canDelete,
                canTransferOwnership: teamPayload.canTransferOwnership,
            });
            setMembers(membersPayload.members.map((member) => ({
                id: member.id,
                userId: member.userId,
                email: member.email,
                role: member.role,
            })));
            setError(null);
            reportLoadMetric({
                elapsedMs: performance.now() - requestStartedAt,
                isRefreshRequest: wasRefreshRequest,
                context: 'teams-bootstrap',
            });
        } catch (teamDataError) {
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return;
            }
            console.error('Error fetching teams page data:', teamDataError);
            setError('Failed to load teams page data');
        } finally {
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return;
            }
            setLoadingDetails(false);
            setHasLoadedOnce(true);
        }
    }, [currentTeam, enabled, getAccessToken, requestedTeamId, setCurrentTeam, teams]);

    useEffect(() => {
        void fetchTeamData();
    }, [fetchTeamData]);

    const refresh = useCallback(async () => {
        await refreshTeamSession(requestedTeamId || undefined);
        await fetchTeamData();
    }, [fetchTeamData, refreshTeamSession, requestedTeamId]);

    return {
        teams,
        currentTeam,
        teamDetails,
        members,
        loading: loadingDetails || isTeamSessionLoading || (enabled && !hasLoadedOnce),
        isInitialLoading: enabled && !hasLoadedOnce,
        hasLoadedOnce,
        error: error ?? teamSessionError,
        refresh,
        setCurrentTeam,
        setTeamDetails,
        setMembers,
    };
}
