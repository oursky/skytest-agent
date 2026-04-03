import {
    dispatchCurrentTeamChanged,
} from './team-session-events';
import { useTeamSession } from './useTeamSession';

export { dispatchCurrentTeamChanged };
export type { CurrentTeam } from './types';

export function useCurrentTeam() {
    const { currentTeam, loading, error, refresh, setCurrentTeam } = useTeamSession();

    return {
        currentTeam,
        loading,
        error,
        refresh: async () => {
            await refresh();
        },
        setCurrentTeam,
    };
}
