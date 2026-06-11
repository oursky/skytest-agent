import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createRequestIdGuard } from '@/hooks/team/request-id-guard';
import { useTeamSession } from '@/hooks/team/useTeamSession';
import { reportLoadMetric } from '@/lib/telemetry/client-metrics';

export function shouldMarkBootstrapLoadedWithoutTeam(isTeamSessionLoading: boolean): boolean {
    return !isTeamSessionLoading;
}

interface LoadForTeamArgs {
    teamId: string;
    token: string | null;
}

interface TeamScopedBootstrapOptions<T> {
    getAccessToken: () => Promise<string | null>;
    requestedTeamId: string;
    enabled: boolean;
    emptyValue: T;
    telemetryContext: string;
    loadErrorMessage: string;
    loadForTeam: (args: LoadForTeamArgs) => Promise<T>;
}

/**
 * Drives the team-scoped data lifecycle shared by every page that renders data
 * for the current team: it resolves the team from the `?teamId` URL param,
 * switches the session when that param points elsewhere, cancels stale
 * responses, and exposes a consistent loading surface. Callers supply only the
 * domain fetch via `loadForTeam`.
 */
export function useTeamScopedBootstrap<T>(options: TeamScopedBootstrapOptions<T>) {
    const { getAccessToken, requestedTeamId, enabled, emptyValue, telemetryContext, loadErrorMessage } = options;

    const {
        teams,
        currentTeam,
        loading: isTeamSessionLoading,
        error: teamSessionError,
        refresh: refreshTeamSession,
        setCurrentTeam,
    } = useTeamSession();

    const [data, setData] = useState<T>(emptyValue);
    const [loadingData, setLoadingData] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hasLoadedOnceRef = useRef(false);
    const requestIdGuardRef = useRef(createRequestIdGuard());

    // Captured in refs so identity changes never retrigger the load effect.
    const emptyValueRef = useRef(emptyValue);
    const loadForTeamRef = useRef(options.loadForTeam);
    loadForTeamRef.current = options.loadForTeam;

    useEffect(() => {
        hasLoadedOnceRef.current = hasLoadedOnce;
    }, [hasLoadedOnce]);

    const load = useCallback(async () => {
        const requestId = requestIdGuardRef.current.next();

        if (!enabled) {
            setData(emptyValueRef.current);
            setLoadingData(false);
            setHasLoadedOnce(false);
            setError(null);
            return;
        }

        const hasRequestedTeam = requestedTeamId.length > 0
            && teams.some((team) => team.id === requestedTeamId);

        if (hasRequestedTeam && currentTeam?.id !== requestedTeamId) {
            try {
                setLoadingData(true);
                setData(emptyValueRef.current);
                await setCurrentTeam(requestedTeamId);
            } catch {
                if (!requestIdGuardRef.current.isLatest(requestId)) {
                    return;
                }
                setError('Failed to switch team');
                setLoadingData(false);
                setHasLoadedOnce(true);
            }
            return;
        }

        if (!currentTeam) {
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return;
            }
            setData(emptyValueRef.current);
            setError(null);
            setLoadingData(false);
            if (shouldMarkBootstrapLoadedWithoutTeam(isTeamSessionLoading)) {
                setHasLoadedOnce(true);
            }
            return;
        }

        try {
            const requestStartedAt = performance.now();
            const wasRefreshRequest = hasLoadedOnceRef.current;
            setLoadingData(true);
            const token = await getAccessToken();
            const result = await loadForTeamRef.current({ teamId: currentTeam.id, token });
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return;
            }
            setData(result);
            setError(null);
            reportLoadMetric({
                elapsedMs: performance.now() - requestStartedAt,
                isRefreshRequest: wasRefreshRequest,
                context: telemetryContext,
            });
        } catch (loadError) {
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return;
            }
            console.error(`Error loading ${telemetryContext} data:`, loadError);
            setError(loadErrorMessage);
        } finally {
            if (!requestIdGuardRef.current.isLatest(requestId)) {
                return;
            }
            setLoadingData(false);
            setHasLoadedOnce(true);
        }
    }, [currentTeam, enabled, getAccessToken, isTeamSessionLoading, loadErrorMessage, requestedTeamId, setCurrentTeam, teams, telemetryContext]);

    useEffect(() => {
        void load();
    }, [load]);

    const refresh = useCallback(async () => {
        await refreshTeamSession(requestedTeamId || undefined);
        await load();
    }, [load, refreshTeamSession, requestedTeamId]);

    return {
        teams,
        currentTeam,
        data,
        setData: setData as Dispatch<SetStateAction<T>>,
        loading: loadingData || isTeamSessionLoading || (enabled && !hasLoadedOnce),
        isInitialLoading: enabled && !hasLoadedOnce,
        hasLoadedOnce,
        error: error ?? teamSessionError,
        refresh,
        setCurrentTeam,
    };
}
