import { describe, expect, it } from 'vitest';
import { shouldMarkProjectsBootstrapLoadedWithoutSelectedTeam } from '@/hooks/project/useProjectsBootstrap';

describe('useProjectsBootstrap initial loading transition', () => {
    it('keeps initial loading when team session is still loading without a selected team', () => {
        expect(shouldMarkProjectsBootstrapLoadedWithoutSelectedTeam(true)).toBe(false);
    });

    it('allows initial loading to complete once team session bootstrap finishes', () => {
        expect(shouldMarkProjectsBootstrapLoadedWithoutSelectedTeam(false)).toBe(true);
    });
});
