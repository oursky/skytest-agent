/**
 * Team-scoped pages addressed without a resource id. `/projects` is the team's
 * project list; `/run` always renders a single project/test-case context.
 * Switching teams here returns to the project list for the new team.
 */
const TEAM_SCOPED_EXACT_PATHS = new Set(['/projects', '/run']);

/**
 * Route prefixes for project-scoped pages addressed by a resource id
 * (e.g. `/projects/<id>`, `/test-cases/<id>/history/<runId>`,
 * `/test-groups/<groupId>/run`, `/test-groups/runs/<sessionId>`). The resource
 * belongs to the previously selected team, so switching teams must return to
 * the project list instead of stranding the user on another team's resource
 * (which would 404 once the old project is no longer in the active team).
 */
const PROJECT_SCOPED_RESOURCE_PREFIXES = ['/projects/', '/test-cases/', '/test-groups/'];

export function isTeamScopedPath(pathname: string): boolean {
    if (TEAM_SCOPED_EXACT_PATHS.has(pathname)) {
        return true;
    }
    return PROJECT_SCOPED_RESOURCE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Resolves where a team switch initiated from `pathname` should land.
 * Returns the `/projects` href to navigate to for team-scoped pages, or `null`
 * to signal that the switch should happen in place on the current page.
 */
export function resolveTeamSwitchHref(pathname: string, teamId: string): string | null {
    if (!isTeamScopedPath(pathname)) {
        return null;
    }
    return `/projects?teamId=${encodeURIComponent(teamId)}`;
}
