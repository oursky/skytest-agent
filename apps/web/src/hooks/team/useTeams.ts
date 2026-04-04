import { useTeamSession } from './useTeamSession';

export type { TeamOption } from './types';

export function useTeams() {
    const { teams, loading, error, refresh } = useTeamSession();

    return {
        teams,
        loading,
        error,
        refresh: async () => {
            await refresh();
        },
    };
}
