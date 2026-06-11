import { describe, expect, it } from 'vitest';
import { shouldMarkBootstrapLoadedWithoutTeam } from '@/hooks/team/useTeamScopedBootstrap';

describe('useTeamScopedBootstrap initial loading transition', () => {
    it('keeps initial loading while the team session is still loading without a selected team', () => {
        expect(shouldMarkBootstrapLoadedWithoutTeam(true)).toBe(false);
    });

    it('allows initial loading to complete once the team session bootstrap finishes', () => {
        expect(shouldMarkBootstrapLoadedWithoutTeam(false)).toBe(true);
    });
});
