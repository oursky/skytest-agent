const TAB_CURRENT_TEAM_STORAGE_KEY = 'skytest:tab-current-team';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function resolveStorage(explicit?: StorageLike | null): StorageLike | null {
    if (explicit !== undefined) {
        return explicit;
    }
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

export function readTabTeamSelection(storage?: StorageLike | null): string | null {
    const store = resolveStorage(storage);
    if (!store) {
        return null;
    }
    try {
        const value = store.getItem(TAB_CURRENT_TEAM_STORAGE_KEY);
        return value && value.trim() ? value : null;
    } catch {
        return null;
    }
}

export function writeTabTeamSelection(teamId: string | null, storage?: StorageLike | null): void {
    const store = resolveStorage(storage);
    if (!store) {
        return;
    }
    try {
        if (teamId && teamId.trim()) {
            store.setItem(TAB_CURRENT_TEAM_STORAGE_KEY, teamId);
        } else {
            store.removeItem(TAB_CURRENT_TEAM_STORAGE_KEY);
        }
    } catch {
        // sessionStorage writes can throw in private mode or when over quota; selection stays in memory.
    }
}

export type { StorageLike };
