import { describe, expect, it } from 'vitest';
import { isTeamScopedPath, resolveTeamSwitchHref } from '@/hooks/team/team-switch-target';

describe('resolveTeamSwitchHref', () => {
    it('navigates to the project list from the list page itself', () => {
        expect(resolveTeamSwitchHref('/projects', 'team-b')).toBe('/projects?teamId=team-b');
    });

    it('navigates back to the project list from project-scoped resource pages', () => {
        expect(resolveTeamSwitchHref('/projects/abc123', 'team-b')).toBe('/projects?teamId=team-b');
        expect(resolveTeamSwitchHref('/test-cases/tc-1/history', 'team-b')).toBe('/projects?teamId=team-b');
        expect(resolveTeamSwitchHref('/test-cases/tc-1/history/run-9', 'team-b')).toBe('/projects?teamId=team-b');
        expect(resolveTeamSwitchHref('/run', 'team-b')).toBe('/projects?teamId=team-b');
    });

    it('encodes the team id in the navigation href', () => {
        expect(resolveTeamSwitchHref('/projects/abc', 'team b/c')).toBe('/projects?teamId=team%20b%2Fc');
    });

    it('switches in place (no navigation) on non-project pages', () => {
        expect(resolveTeamSwitchHref('/teams', 'team-b')).toBeNull();
        expect(resolveTeamSwitchHref('/welcome', 'team-b')).toBeNull();
        expect(resolveTeamSwitchHref('/mcp', 'team-b')).toBeNull();
    });

    it('does not treat unrelated paths with a shared stem as team-scoped', () => {
        expect(isTeamScopedPath('/runners')).toBe(false);
        expect(isTeamScopedPath('/projectsettings')).toBe(false);
    });
});
