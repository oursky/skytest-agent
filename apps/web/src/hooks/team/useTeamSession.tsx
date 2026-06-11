'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useAuth } from '@/app/auth-provider';
import { assertTeamSessionInvariants } from '@/hooks/team/team-session-invariants';
import {
    createTeamAndFetchSession,
    deleteTeamAndFetchSession,
    fetchTeamSessionPayload,
    removeMemberAndFetchSession,
    switchTeamAndFetchSession,
} from '@/hooks/team/team-session-mutations';
import { createRequestIdGuard } from '@/hooks/team/request-id-guard';
import {
    readTabTeamSelection,
    writeTabTeamSelection,
} from '@/hooks/team/tab-team-selection';
import type { CurrentTeam, TeamOption } from '@/hooks/team/types';
import type { TeamSessionPayload } from '@/hooks/team/team-session-mutations';

interface TeamSessionContextValue {
    teams: TeamOption[];
    currentTeam: CurrentTeam | null;
    currentTeamId: string | null;
    loading: boolean;
    error: string | null;
    pendingTeamId: string | null;
    previewTeamSwitch: (teamId: string | null) => void;
    refresh: (teamIdOverride?: string) => Promise<TeamSessionPayload | null>;
    setCurrentTeam: (teamId: string) => Promise<CurrentTeam>;
    createTeam: (name: string) => Promise<{ teamId: string }>;
    deleteTeam: (teamId: string) => Promise<{ nextTeamId: string | null }>;
    removeMember: (teamId: string, memberId: string) => Promise<void>;
}

const TeamSessionContext = createContext<TeamSessionContextValue | null>(null);

export function TeamSessionProvider({ children }: { children: React.ReactNode }) {
    const { isLoggedIn, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const enabled = isLoggedIn && !isAuthLoading;

    const [teams, setTeams] = useState<TeamOption[]>([]);
    const [currentTeam, setCurrentTeam] = useState<CurrentTeam | null>(null);
    const [loading, setLoading] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
    const requestIdGuardRef = useRef(createRequestIdGuard());
    const mutationIdGuardRef = useRef(createRequestIdGuard());

    useEffect(() => {
        if (pendingTeamId && currentTeam?.id === pendingTeamId) {
            setPendingTeamId(null);
        }
    }, [currentTeam?.id, pendingTeamId]);

    const applyCanonicalPayload = useCallback((payload: TeamSessionPayload) => {
        assertTeamSessionInvariants(payload.teams, payload.currentTeam);
        setTeams(payload.teams);
        setCurrentTeam(payload.currentTeam);
        writeTabTeamSelection(payload.currentTeam?.id ?? null);
        setError(null);
    }, []);

    const getMutationContext = useCallback(() => ({
        getAccessToken,
        fetchLike: (input: string, init?: RequestInit) => window.fetch(input, init),
        origin: window.location.origin,
    }), [getAccessToken]);

    const refresh = useCallback(async (teamIdOverride?: string): Promise<TeamSessionPayload | null> => {
        const requestId = requestIdGuardRef.current.next();

        if (!enabled) {
            setTeams([]);
            setCurrentTeam(null);
            setLoading(false);
            setHasLoadedOnce(false);
            setError(null);
            return null;
        }

        try {
            setLoading(true);
            const tabTeamId = teamIdOverride ?? readTabTeamSelection() ?? undefined;
            const payload = await fetchTeamSessionPayload(getMutationContext(), tabTeamId);
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return null;
            }

            applyCanonicalPayload(payload);
            return payload;
        } catch (refreshError) {
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return null;
            }

            console.error('Error fetching team session payload:', refreshError);
            setError('Failed to load team session data');
            return null;
        } finally {
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return null;
            }

            setLoading(false);
            setHasLoadedOnce(true);
        }
    }, [applyCanonicalPayload, enabled, getMutationContext]);

    const switchTeam = useCallback(async (teamId: string): Promise<CurrentTeam> => {
        const mutationId = mutationIdGuardRef.current.next();
        requestIdGuardRef.current.next();
        setPendingTeamId(teamId);
        try {
            const result = await switchTeamAndFetchSession(getMutationContext(), teamId);
            if (!mutationIdGuardRef.current.isLatest(mutationId)) {
                return result.switchedTeam;
            }
            applyCanonicalPayload(result.session);
            return result.switchedTeam;
        } finally {
            if (mutationIdGuardRef.current.isLatest(mutationId)) {
                setPendingTeamId(null);
            }
        }
    }, [applyCanonicalPayload, getMutationContext]);

    const createTeam = useCallback(async (name: string): Promise<{ teamId: string }> => {
        const mutationId = mutationIdGuardRef.current.next();
        requestIdGuardRef.current.next();
        const result = await createTeamAndFetchSession(getMutationContext(), name);
        if (!mutationIdGuardRef.current.isLatest(mutationId)) {
            return { teamId: result.teamId };
        }
        applyCanonicalPayload(result.session);
        return { teamId: result.teamId };
    }, [applyCanonicalPayload, getMutationContext]);

    const deleteTeam = useCallback(async (teamId: string): Promise<{ nextTeamId: string | null }> => {
        const mutationId = mutationIdGuardRef.current.next();
        requestIdGuardRef.current.next();
        const result = await deleteTeamAndFetchSession(getMutationContext(), teamId);
        if (!mutationIdGuardRef.current.isLatest(mutationId)) {
            return { nextTeamId: result.nextTeamId };
        }
        applyCanonicalPayload(result.session);
        return { nextTeamId: result.nextTeamId };
    }, [applyCanonicalPayload, getMutationContext]);

    const removeMember = useCallback(async (teamId: string, memberId: string): Promise<void> => {
        const mutationId = mutationIdGuardRef.current.next();
        requestIdGuardRef.current.next();
        const payload = await removeMemberAndFetchSession(getMutationContext(), teamId, memberId);
        if (!mutationIdGuardRef.current.isLatest(mutationId)) {
            return;
        }
        applyCanonicalPayload(payload);
    }, [applyCanonicalPayload, getMutationContext]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const value = useMemo<TeamSessionContextValue>(() => ({
        teams,
        currentTeam,
        currentTeamId: currentTeam?.id ?? null,
        loading: loading || (enabled && !hasLoadedOnce),
        error,
        pendingTeamId,
        previewTeamSwitch: setPendingTeamId,
        refresh,
        setCurrentTeam: switchTeam,
        createTeam,
        deleteTeam,
        removeMember,
    }), [
        createTeam,
        currentTeam,
        deleteTeam,
        enabled,
        error,
        hasLoadedOnce,
        loading,
        pendingTeamId,
        refresh,
        removeMember,
        switchTeam,
        teams,
    ]);

    return (
        <TeamSessionContext.Provider value={value}>
            {children}
        </TeamSessionContext.Provider>
    );
}

export function useTeamSession() {
    const context = useContext(TeamSessionContext);
    if (!context) {
        throw new Error('useTeamSession must be used within TeamSessionProvider');
    }
    return context;
}
