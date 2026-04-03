export const TEAMS_CHANGED_EVENT = 'skytest:teams-changed';
export const CURRENT_TEAM_CHANGED_EVENT = 'skytest:current-team-changed';

export function dispatchTeamsChanged() {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new CustomEvent(TEAMS_CHANGED_EVENT));
}

export function dispatchCurrentTeamChanged(teamId: string | null) {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new CustomEvent(CURRENT_TEAM_CHANGED_EVENT, {
        detail: { teamId },
    }));
}
