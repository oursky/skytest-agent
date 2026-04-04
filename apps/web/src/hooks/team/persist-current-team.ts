import type { CurrentTeam } from './types';

export async function persistCurrentTeamSelection(
    getAccessToken: (() => Promise<string | null>) | undefined,
    teamId: string,
): Promise<CurrentTeam> {
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
    };

    if (getAccessToken) {
        const token = await getAccessToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
    }

    const response = await fetch('/api/teams/current', {
        method: 'POST',
        headers,
        body: JSON.stringify({ teamId }),
    });

    if (!response.ok) {
        throw new Error('Failed to persist current team');
    }

    const payload = await response.json() as CurrentTeam;
    return payload;
}
