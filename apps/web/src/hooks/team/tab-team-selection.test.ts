import { describe, expect, it } from 'vitest';
import {
    readTabTeamSelection,
    writeTabTeamSelection,
    type StorageLike,
} from '@/hooks/team/tab-team-selection';

function createMemoryStorage(): StorageLike {
    const map = new Map<string, string>();
    return {
        getItem: (key) => (map.has(key) ? map.get(key)! : null),
        setItem: (key, value) => {
            map.set(key, value);
        },
        removeItem: (key) => {
            map.delete(key);
        },
    };
}

function resolveTeamForTab(
    requestedTeamId: string | undefined,
    sharedCookieTeamId: string | null,
    tabStorage: StorageLike,
): string | null {
    const tabTeamId = requestedTeamId ?? readTabTeamSelection(tabStorage) ?? undefined;
    return tabTeamId ?? sharedCookieTeamId;
}

describe('tab-team-selection', () => {
    it('round-trips a stored selection', () => {
        const storage = createMemoryStorage();
        writeTabTeamSelection('team-a', storage);
        expect(readTabTeamSelection(storage)).toBe('team-a');
    });

    it('treats empty/blank values as no selection and clears on null', () => {
        const storage = createMemoryStorage();
        writeTabTeamSelection('   ', storage);
        expect(readTabTeamSelection(storage)).toBeNull();

        writeTabTeamSelection('team-a', storage);
        writeTabTeamSelection(null, storage);
        expect(readTabTeamSelection(storage)).toBeNull();
    });

    it('keeps two tabs independent when the shared cookie is mutated by one tab', () => {
        const tabA = createMemoryStorage();
        const tabB = createMemoryStorage();

        // Both tabs open on Team A; shared cookie reflects Team A.
        let sharedCookieTeamId: string | null = 'team-a';
        writeTabTeamSelection('team-a', tabA);
        writeTabTeamSelection('team-a', tabB);

        // Tab B switches to Team B: its tab selection and the shared cookie update.
        writeTabTeamSelection('team-b', tabB);
        sharedCookieTeamId = 'team-b';

        // Tab A refreshes with no explicit override after "some operations".
        // Before the fix it would follow the shared cookie (team-b); now it
        // reasserts its own stored selection.
        expect(resolveTeamForTab(undefined, sharedCookieTeamId, tabA)).toBe('team-a');
        expect(resolveTeamForTab(undefined, sharedCookieTeamId, tabB)).toBe('team-b');
    });

    it('falls back to the shared cookie for a fresh tab with no stored selection', () => {
        const freshTab = createMemoryStorage();
        expect(resolveTeamForTab(undefined, 'team-b', freshTab)).toBe('team-b');
    });

    it('honors an explicit requested team over the stored selection', () => {
        const storage = createMemoryStorage();
        writeTabTeamSelection('team-a', storage);
        expect(resolveTeamForTab('team-c', 'team-b', storage)).toBe('team-c');
    });
});
