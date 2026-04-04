import type { CurrentTeam, TeamOption } from '@/hooks/team/types';

interface TeamSessionInvariantResult {
    valid: boolean;
    reason?: string;
}

function validateTeamSessionInvariants(
    teams: TeamOption[],
    currentTeam: CurrentTeam | null,
): TeamSessionInvariantResult {
    if (teams.length === 0 && currentTeam !== null) {
        return {
            valid: false,
            reason: 'teams.length === 0 requires currentTeam === null',
        };
    }

    if (currentTeam && !teams.some((team) => team.id === currentTeam.id)) {
        return {
            valid: false,
            reason: 'currentTeam must exist in teams list',
        };
    }

    return { valid: true };
}

export function assertTeamSessionInvariants(
    teams: TeamOption[],
    currentTeam: CurrentTeam | null,
): void {
    if (process.env.NODE_ENV === 'production') {
        return;
    }

    const result = validateTeamSessionInvariants(teams, currentTeam);
    if (result.valid) {
        return;
    }

    console.error('Invalid team session state', {
        reason: result.reason,
        teams,
        currentTeam,
    });
}

export { validateTeamSessionInvariants };
