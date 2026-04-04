import { describe, expect, it } from 'vitest';
import { validateTeamSessionInvariants } from '@/hooks/team/team-session-invariants';

describe('team-session-invariants', () => {
    it('rejects states where currentTeam is missing from teams list', () => {
        const result = validateTeamSessionInvariants(
            [{ id: 'team-1', name: 'Team 1', role: 'OWNER', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
            { id: 'team-2', name: 'Team 2', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        );

        expect(result.valid).toBe(false);
    });

    it('rejects states where teams is empty but currentTeam is set', () => {
        const result = validateTeamSessionInvariants(
            [],
            { id: 'team-1', name: 'Team 1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        );

        expect(result.valid).toBe(false);
    });

    it('accepts valid canonical session state', () => {
        const result = validateTeamSessionInvariants(
            [{ id: 'team-1', name: 'Team 1', role: 'OWNER', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
            { id: 'team-1', name: 'Team 1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        );

        expect(result.valid).toBe(true);
    });
});
