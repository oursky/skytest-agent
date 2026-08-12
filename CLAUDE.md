# SkyTest Agent - AI Coding Guidelines

## Project Map

Keep this map at the domain level. Package manifests and the source tree are the
source of truth for individual files and dependency versions.

```
apps/
├── web/                       # Next.js control plane, workers, and web-owned scripts
│   └── src/
│       ├── app/               # Pages and API routes
│       ├── components/        # Feature-first and shared React UI
│       ├── lib/               # Backend domain modules and shared services
│       ├── workers/           # Maintenance and browser dispatch loops
│       ├── config/            # Environment-backed application config
│       ├── i18n/              # Locale definitions and message loading
│       └── types/             # Shared TypeScript contracts
├── cli/                       # skytest-runner CLI
└── macos-runner/              # Android execution runtime
packages/runner-protocol/      # Shared runner protocol contract
infra/                         # Local services and bootstrap tooling
docs/                          # Operator and maintainer documentation
skills/                        # Installable agent workflows
tools/                         # Development and release tooling
```

## Task Routing

| Task | Start Here | Related Files |
|------|------------|---------------|
| Fix test execution | `apps/web/src/lib/runtime/test-runner.ts` | `apps/web/src/lib/runtime/android-runtime-helpers.ts`, `apps/web/src/lib/runtime/assertion-verifier.ts`, `apps/web/src/lib/runtime/playwright-code-execution.ts`, `apps/web/src/lib/runtime/execution-files.ts`, `apps/web/src/lib/runtime/local-browser-runner.ts`, `apps/macos-runner/runner/index.ts` |
| Fix browser run dispatch | `apps/web/src/lib/runtime/browser-run-dispatcher.ts` | `apps/web/src/workers/browser-runner.ts`, `apps/web/src/app/api/test-runs/dispatch/route.ts` |
| Fix run scheduling/claiming | `apps/web/src/lib/runners/claim-service.ts` | `apps/web/src/app/api/runners/v1/jobs/claim/route.ts` |
| Fix runner event ingestion | `apps/web/src/lib/runners/event-service.ts` | `apps/web/src/app/api/runners/v1/jobs/[id]/events/route.ts` |
| Fix SSE/real-time updates | `apps/web/src/app/api/test-runs/[id]/events/route.ts` | `apps/web/src/components/features/run-results/ui/ResultViewer.tsx` |
| Fix test case CRUD | `apps/web/src/app/api/test-cases/` | `apps/web/src/types/test.ts`, `apps/web/src/lib/test-cases/` |
| Fix project CRUD/configs | `apps/web/src/app/api/projects/` | `apps/web/src/lib/core/prisma.ts` |
| Fix team runners/members/usage | `apps/web/src/app/api/teams/` | `apps/web/src/components/features/team-runners/`, `apps/web/src/components/features/team-members/`, `apps/web/src/components/features/team-usage/` |
| Fix Slack notification | `apps/web/src/lib/integrations/slack/notifier.ts` | `apps/web/src/lib/integrations/slack/subscriber.ts`, `apps/web/src/lib/integrations/slack/group-notifier.ts`, `apps/web/src/lib/runners/domain-events.ts` |
| Fix authentication | `apps/web/src/lib/security/auth.ts` | `apps/web/src/app/api/`, `apps/web/src/lib/runners/auth.ts` |
| Fix API route auth/access guards | `apps/web/src/lib/security/team-route-access.ts` | `apps/web/src/lib/security/project-route-access.ts`, `apps/web/src/lib/security/test-case-route-access.ts`, `apps/web/src/lib/security/api-route-standards.ts` |
| Fix MCP tooling | `apps/web/src/lib/mcp/server-registry.ts` | `apps/web/src/lib/mcp/server-tools.ts`, `apps/web/src/lib/mcp/server-schemas.ts`, `apps/web/src/lib/mcp/server-auth.ts`, `apps/web/src/lib/mcp/server-response.ts`, `apps/web/src/lib/mcp/test-case-mutation-tools.ts`, `apps/web/src/app/api/mcp/route.ts` |
| Change DB schema | `apps/web/prisma/schema.prisma` | `apps/web/src/types/`, `apps/web/src/lib/core/prisma.ts` |
| Fix dependency security regressions | `apps/web/scripts/security/check-locked-min-versions.mjs` | `package.json`, `apps/web/package.json`, `apps/web/scripts/quality/check-overrides-drift.mjs`, `docs/maintainers/dependency-upgrade-protocol.md` |
| Attribute a verify failure | `apps/web/scripts/quality/explain-verify-failure.mjs` | `docs/maintainers/agent-session-rules.md` |

## Tech Stack

Dependency versions are pinned in `package.json`, workspace manifests, and the
`Dockerfile`; do not duplicate them here.

- Next.js App Router, React, TailwindCSS
- Prisma + PostgreSQL, Server-Sent Events
- Playwright, Midscene.js

## Docs To Read First
- `docs/maintainers/agent-session-rules.md` - Session rules for Claude and Codex (verify attribution, hotspot awareness, override workflow, force-push protocol)
- `infra/README.md` - Local infra topology and shared deployment dependencies
- `docs/maintainers/coding-agent-maintenance-guide.md` - Runtime invariants and common footguns
- `docs/maintainers/dependency-upgrade-protocol.md` - Reproducer-first workflow for npm overrides and CVE patching
- `docs/maintainers/android-runtime-maintenance.md` - Android runtime behavior and isolation model
- `docs/maintainers/runner-queue-diagnostics.md` - Queue debugging and failure tracing
- `docs/maintainers/frontend-runtime-debugging.md` - Frontend/runtime integration debugging
- `docs/maintainers/mcp-server-tooling.md` - MCP tool contracts for registered tools
- `docs/maintainers/test-case-excel-format.md` - Import/export format contract

## Docs Structure
`docs/maintainers/` holds the runtime invariants and contracts a coding agent needs; it is the only
documentation set this repo keeps. Operator-facing setup runbooks were removed deliberately — do not
reintroduce them here. `infra/` documents local service topology.

## Infra Privacy Notes
- `infra/docker/docker-compose.local.yml` is the source of truth for local development services.
- Shared deployment orchestration is maintained in a private infrastructure repository.
- Do not expose internal deployment repository names or URLs in committed docs or code comments.

## Rules
1. **No `any`** - All types in `apps/web/src/types/index.ts`
2. **Singletons only** - Use `apps/web/src/lib/core/prisma.ts`, never create new Prisma instances
3. **No hardcoding** - Use `apps/web/src/config/app.ts`
4. **Minimal diffs** - Change only what's necessary
5. **Match existing style** - No reformatting unrelated code
6. **No destructive git operations without explicit confirmation**
   - Do not run `git restore`, `git checkout -- <file>`, `git reset --hard`, `git clean`, `git rebase`, or force-push without the user's permission.
   - Before any scope cleanup, create a safety snapshot via `git stash push -u -m "wip backup"` or a WIP commit.

## Workflow
- Align on intent and success criteria before coding.
- For non-trivial changes, capture design notes in a focused doc under `docs/maintainers/`.
- For multi-step work, keep a task-by-task implementation checklist in PR/branch notes.
- When changing runtime behavior (runner queueing, Android lifecycle, import/export, dispatch), update the relevant docs in `docs/maintainers/` and `infra/` in the same change series.
- Prefer test-first for new behavior; reproduce and trace root causes before fixes.
- Self-review spec compliance first, then code quality; verify before completion claims.
- Run `npm run verify` before committing (lint, TypeScript compile, and dependency audit).

## Code Style
**Code as Documentation**: Write self-explanatory code. Avoid comments unless absolutely necessary.
- Good variable/function names eliminate need for comments
- Only add comments for non-obvious "why" (not "what")
- Never comment obvious code like `// loop through items` or `// validate input`

## Commands
- `make bootstrap` - Install dependencies, start local services, and apply schema
- `make clean` - Remove regenerable build, test, and TypeScript artifacts
- `make clean-data` - Delete ignored local database and uploaded test data
- `make clean-deps` - Remove workspace dependencies
- `make dev` - Start local control plane with maintenance and browser worker loops
- `make verify` - Run repository verification checks
- `npm run dev` - Start dev server directly
- `npm run lint` - Run ESLint and TypeScript compile checks
- `npm run audit` - Audit lockfile dependencies for moderate/high/critical vulnerabilities
- `npm run verify` - Run lint and audit checks
- `npm run --workspace @skytest/web verify:explain` - Run verify and attribute any failure to its checker
- `npx prisma studio --schema apps/web/prisma/schema.prisma` - Open DB GUI
- `npx prisma migrate deploy --schema apps/web/prisma/schema.prisma` - Apply committed migrations

## Skills

On-demand agent workflows live in `skills/` (installation: `skills/README.md`):

- **Development**: `/commit` (plan + verify-gated commits), `/review`, `/plan`, `/debug` — wired to this repo's verify tooling and maintainer docs
- **SkyTest**: `/skytest` (create/manage test cases via MCP, playwright-code-first), `/skytest-fix` (diagnose failing runs)
- **Linear**: `/linear-bug-report`, `/linear-bug-revise`, `/linear-bug-to-skytest`

## Common Patterns

### API Route with Access Guard

Use the route guards in `apps/web/src/lib/security/` — never hand-roll auth or ownership checks. Access is team-membership based, not single-owner `userId` equality.

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { apiError } from '@/lib/security/api-route-standards';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    const { id } = guard.params;
    const { userId } = guard;
    const project = await prisma.project.findFirst({
        where: {
            id,
            team: { memberships: { some: { userId } } },
        },
        select: { id: true, name: true, teamId: true },
    });
    if (!project) {
        return apiError({ status: 404, code: 'NOT_FOUND', error: 'Not found' });
    }

    return NextResponse.json(project);
}
```

- Pick the guard matching the route scope: `guardTeamRouteRequest`, `guardProjectRouteRequest`, or `guardTestCaseRouteRequest`.
- Scope every Prisma query by team membership (`team: { memberships: { some: { userId } } }`) — the guard alone does not scope nested resources (test runs, configs, files).
- Use `apiError` from `api-route-standards.ts` for error responses, not ad-hoc `NextResponse.json({ error })`.

### Pagination
```typescript
const url = new URL(request.url);
const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));
const skip = (page - 1) * limit;

const [data, total] = await Promise.all([
    prisma.testRun.findMany({ where, orderBy, skip, take: limit }),
    prisma.testRun.count({ where })
]);

return NextResponse.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
});
```

### Adding a Database Field
1. Edit `apps/web/prisma/schema.prisma`
2. Run `npx prisma migrate dev --schema apps/web/prisma/schema.prisma`
3. Update types in `apps/web/src/types/` if needed
4. Re-export from `apps/web/src/types/index.ts`

## Security Checklist
- [ ] Route wrapped in the matching access guard (`guardTeamRouteRequest` / `guardProjectRouteRequest` / `guardTestCaseRouteRequest`)
- [ ] Prisma queries scoped by team membership, not raw IDs
- [ ] Input validated before database operations
- [ ] Sensitive fields not exposed in responses
- [ ] Errors returned via `apiError` (no internal details leaked)

## File Placement

| Type | Location |
|------|----------|
| API endpoint | `apps/web/src/app/api/<resource>/route.ts` |
| Page | `apps/web/src/app/<path>/page.tsx` |
| Feature component | `apps/web/src/components/features/<feature>/ui/<Name>.tsx` |
| Feature hooks/model | `apps/web/src/components/features/<feature>/{hooks,model}/<module>.ts` |
| Shared/Layout component | `apps/web/src/components/{shared,layout}/<Name>.tsx` |
| Shared logic | `apps/web/src/lib/<domain>/<module>.ts` |
| Types | `apps/web/src/types/<category>.ts` + re-export in `index.ts` |
| Worker | `apps/web/src/workers/<worker>.ts` |
| Config | `apps/web/src/config/app.ts` |
| i18n messages | `apps/web/src/i18n/locales/` (all three locales: en, zh-Hant, zh-Hans) |

## i18n Guidelines
- All user-facing text must use i18n keys via `t('key.path')`
- Add keys to all three files in `apps/web/src/i18n/locales/`
- Keep translations concise; avoid duplicate keys for minor variations
- Use interpolation for dynamic values: `t('key', { name: value })`

## What NOT to Do
- Don't create new Prisma or queue instances
- Don't add `any` types
- Don't hardcode values (use config)
- Don't refactor unrelated code
- Don't skip authentication on API routes
- Don't create duplicate i18n keys for minor text variations
