import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createTeamAndFetchSession,
    deleteTeamAndFetchSession,
    removeMemberAndFetchSession,
} from '@/hooks/team/team-session-mutations';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('team-session-mutations scenarios', () => {
    it('deletes current team and resolves next team from canonical bootstrap payload', async () => {
        const fetchLike = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ success: true }))
            .mockResolvedValueOnce(jsonResponse({
                teams: [
                    { id: 'team-2', name: 'Team 2', role: 'OWNER', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
                    { id: 'team-3', name: 'Team 3', role: 'MEMBER', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
                ],
                currentTeam: {
                    id: 'team-2',
                    name: 'Team 2',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-02T00:00:00.000Z',
                },
            }));

        const result = await deleteTeamAndFetchSession({
            getAccessToken: async () => 'token',
            fetchLike,
            origin: 'http://localhost',
        }, 'team-1');

        expect(result.nextTeamId).toBe('team-2');
        expect(fetchLike).toHaveBeenCalledTimes(2);
        expect(String(fetchLike.mock.calls[0]?.[0])).toContain('/api/teams/team-1');
        expect(String(fetchLike.mock.calls[1]?.[0])).toContain('/api/teams/bootstrap');
    });

    it.each(['header', 'projects', 'welcome'])(
        'creates team via the same centralized flow (%s)',
        async () => {
            const fetchLike = vi.fn()
                .mockResolvedValueOnce(jsonResponse({ id: 'team-new' }, 201))
                .mockResolvedValueOnce(jsonResponse({
                    id: 'team-new',
                    name: 'Team New',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                }))
                .mockResolvedValueOnce(jsonResponse({
                    teams: [
                        { id: 'team-new', name: 'Team New', role: 'OWNER', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
                    ],
                    currentTeam: {
                        id: 'team-new',
                        name: 'Team New',
                        createdAt: '2026-01-01T00:00:00.000Z',
                        updatedAt: '2026-01-01T00:00:00.000Z',
                    },
                }));

            const result = await createTeamAndFetchSession({
                getAccessToken: async () => 'token',
                fetchLike,
                origin: 'http://localhost',
            }, 'Team New');

            expect(result.teamId).toBe('team-new');
            expect(result.session.currentTeam?.id).toBe('team-new');
            expect(fetchLike).toHaveBeenCalledTimes(3);
        },
    );

    it('removes member and refreshes canonical team session while viewing that team', async () => {
        const fetchLike = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ success: true }))
            .mockResolvedValueOnce(jsonResponse({
                teams: [
                    { id: 'team-2', name: 'Team 2', role: 'OWNER', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
                ],
                currentTeam: {
                    id: 'team-2',
                    name: 'Team 2',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-02T00:00:00.000Z',
                },
            }));

        const session = await removeMemberAndFetchSession({
            getAccessToken: async () => 'token',
            fetchLike,
            origin: 'http://localhost',
        }, 'team-1', 'member-1');

        expect(session.currentTeam?.id).toBe('team-2');
        expect(fetchLike).toHaveBeenCalledTimes(2);
        expect(String(fetchLike.mock.calls[0]?.[0])).toContain('/api/teams/team-1/members/member-1');
    });
});
