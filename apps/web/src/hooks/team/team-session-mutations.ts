import type { CurrentTeam, TeamOption } from '@/hooks/team/types';

export interface TeamSessionPayload {
    teams: TeamOption[];
    currentTeam: CurrentTeam | null;
}

interface ApiErrorShape {
    error?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface TeamSessionContext {
    getAccessToken: () => Promise<string | null>;
    fetchLike: FetchLike;
    origin: string;
}

async function buildHeaders(
    getAccessToken: () => Promise<string | null>,
    withJsonContentType = false,
): Promise<HeadersInit> {
    const headers: HeadersInit = withJsonContentType ? { 'Content-Type': 'application/json' } : {};
    const token = await getAccessToken();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
    const payload = await response.json().catch(() => null) as ApiErrorShape | null;
    return payload?.error && payload.error.trim() ? payload.error : fallback;
}

async function persistCurrentTeam(
    context: TeamSessionContext,
    teamId: string,
): Promise<CurrentTeam> {
    const response = await context.fetchLike('/api/teams/current', {
        method: 'POST',
        headers: await buildHeaders(context.getAccessToken, true),
        body: JSON.stringify({ teamId }),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, 'Failed to persist current team'));
    }

    return response.json() as Promise<CurrentTeam>;
}

export async function fetchTeamSessionPayload(
    context: TeamSessionContext,
    teamIdOverride?: string,
): Promise<TeamSessionPayload> {
    const url = new URL('/api/teams/bootstrap', context.origin);
    if (teamIdOverride) {
        url.searchParams.set('teamId', teamIdOverride);
    }

    const response = await context.fetchLike(url.toString(), {
        headers: await buildHeaders(context.getAccessToken),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, 'Failed to fetch team session payload'));
    }

    return response.json() as Promise<TeamSessionPayload>;
}

export async function switchTeamAndFetchSession(
    context: TeamSessionContext,
    teamId: string,
): Promise<{ switchedTeam: CurrentTeam; session: TeamSessionPayload }> {
    const switchedTeam = await persistCurrentTeam(context, teamId);
    const session = await fetchTeamSessionPayload(context, teamId);
    return { switchedTeam, session };
}

export async function createTeamAndFetchSession(
    context: TeamSessionContext,
    name: string,
): Promise<{ teamId: string; session: TeamSessionPayload }> {
    const trimmedName = name.trim();
    if (!trimmedName) {
        throw new Error('Team name is required');
    }

    const createResponse = await context.fetchLike('/api/teams', {
        method: 'POST',
        headers: await buildHeaders(context.getAccessToken, true),
        body: JSON.stringify({ name: trimmedName }),
    });

    if (!createResponse.ok) {
        throw new Error(await parseApiError(createResponse, 'Failed to create team'));
    }

    const createPayload = await createResponse.json() as { id?: string } | null;
    const createdTeamId = createPayload?.id?.trim() ?? '';
    if (!createdTeamId) {
        throw new Error('Failed to create team');
    }

    await persistCurrentTeam(context, createdTeamId);
    const session = await fetchTeamSessionPayload(context, createdTeamId);
    return { teamId: createdTeamId, session };
}

export async function deleteTeamAndFetchSession(
    context: TeamSessionContext,
    teamId: string,
): Promise<{ nextTeamId: string | null; session: TeamSessionPayload }> {
    const deleteResponse = await context.fetchLike(`/api/teams/${encodeURIComponent(teamId)}`, {
        method: 'DELETE',
        headers: await buildHeaders(context.getAccessToken),
    });

    if (!deleteResponse.ok) {
        throw new Error(await parseApiError(deleteResponse, 'Failed to delete team'));
    }

    const session = await fetchTeamSessionPayload(context);
    return { nextTeamId: session.currentTeam?.id ?? null, session };
}

export async function removeMemberAndFetchSession(
    context: TeamSessionContext,
    teamId: string,
    memberId: string,
): Promise<TeamSessionPayload> {
    const removeResponse = await context.fetchLike(
        `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}`,
        {
            method: 'DELETE',
            headers: await buildHeaders(context.getAccessToken),
        },
    );

    if (!removeResponse.ok) {
        throw new Error(await parseApiError(removeResponse, 'Failed to remove team member'));
    }

    return fetchTeamSessionPayload(context);
}

export type { FetchLike, TeamSessionContext };
