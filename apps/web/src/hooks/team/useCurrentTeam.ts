import { useTeamSession } from './useTeamSession';

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
