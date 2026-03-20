# SkyTest Agent - AI Coding Guidelines

## Project Map
```
apps/web/src/
├── lib/                           # Backend domain modules + singletons
│   ├── runtime/                   # Run lifecycle and execution
│   │   ├── test-runner.ts         # Shared execution engine
│   │   ├── local-browser-runner.ts# Browser runtime dispatch target
│   │   └── usage.ts               # API usage tracking
│   ├── runners/                   # Runner orchestration + queueing services
│   ├── android/                   # Android devices/emulators runtime
│   ├── core/                      # Shared core modules (prisma/logger/errors)
│   ├── security/                  # Authentication + security helpers
│   ├── storage/                   # Object storage adapters + helpers
│   ├── test-cases/                # Test case domain logic
│   ├── test-config/               # Test config parsing/validation/sorting
│   └── mcp/                       # MCP server/tooling
│
├── app/                           # Next.js App Router
│   ├── api/                       # REST API endpoints
│   │   ├── projects/              # Project CRUD + project configs
│   │   ├── teams/                 # Team settings, members, runners, usage
│   │   ├── runners/v1/            # Runner protocol endpoints
│   │   ├── test-cases/            # Test case CRUD + files + history + export
│   │   ├── test-runs/             # Run status, cancel, SSE events, dispatch
│   │   ├── user/                  # User settings & API keys
│   │   ├── mcp/                   # MCP transport endpoint
│   │   └── health/                # Live/ready/dependencies probes
│   ├── projects/                  # Project list & detail pages
│   ├── teams/                     # Team settings pages
│   ├── test-cases/[id]/           # Test case history views
│   └── run/                       # Main test runner page
│
├── components/                    # React components (feature-first)
│   ├── features/
│   │   ├── test-builder/          # Test builder + step editing
│   │   ├── test-configurations/   # Test-level config composition
│   │   ├── project-configurations/# Project-level config management
│   │   ├── test-files/            # File upload/list widgets
│   │   ├── run-results/           # Run timeline + status + artifacts
│   │   ├── test-cases/            # Test case list/detail UI
│   │   ├── projects/              # Project list/detail UI
│   │   ├── team-runners/          # Runner inventory + troubleshooting UI
│   │   ├── team-members/          # Team membership UI
│   │   ├── team-usage/            # Team usage UI
│   │   └── team-ai/               # Team AI key/settings UI
│   ├── shared/                    # Cross-feature reusable UI
│   └── layout/                    # Page-level layout primitives
│
├── workers/                       # Long-running maintenance/dispatch loops
│   ├── runner-maintenance.ts
│   └── browser-runner.ts
│
├── types/                         # TypeScript interfaces
│   └── index.ts                   # All type exports
│
├── config/app.ts                  # App configuration
└── i18n/messages.ts               # i18n keys (en/zh-Hant/zh-Hans)
```

## Task Routing

| Task | Start Here | Related Files |
|------|------------|---------------|
| Fix test execution | `apps/web/src/lib/runtime/test-runner.ts` | `apps/web/src/lib/runtime/local-browser-runner.ts`, `apps/macos-runner/runner/index.ts` |
| Fix browser run dispatch | `apps/web/src/lib/runtime/browser-run-dispatcher.ts` | `apps/web/src/workers/browser-runner.ts`, `apps/web/src/app/api/test-runs/dispatch/route.ts` |
| Fix run scheduling/claiming | `apps/web/src/lib/runners/claim-service.ts` | `apps/web/src/app/api/runners/v1/jobs/claim/route.ts` |
| Fix runner event ingestion | `apps/web/src/lib/runners/event-service.ts` | `apps/web/src/app/api/runners/v1/jobs/[id]/events/route.ts` |
| Fix SSE/real-time updates | `apps/web/src/app/api/test-runs/[id]/events/route.ts` | `apps/web/src/components/features/run-results/ui/ResultViewer.tsx` |
| Fix test case CRUD | `apps/web/src/app/api/test-cases/` | `apps/web/src/types/test.ts`, `apps/web/src/lib/test-cases/` |
| Fix project CRUD/configs | `apps/web/src/app/api/projects/` | `apps/web/src/lib/core/prisma.ts` |
| Fix team runners/members/usage | `apps/web/src/app/api/teams/` | `apps/web/src/components/features/team-runners/`, `apps/web/src/components/features/team-members/`, `apps/web/src/components/features/team-usage/` |
| Fix authentication | `apps/web/src/lib/security/auth.ts` | `apps/web/src/app/api/`, `apps/web/src/lib/runners/auth.ts` |
| Fix MCP tooling | `apps/web/src/lib/mcp/` | `apps/web/src/app/api/mcp/route.ts` |
| Change DB schema | `apps/web/prisma/schema.prisma` | `apps/web/src/types/`, `apps/web/src/lib/core/prisma.ts` |

## Tech Stack
- Next.js 16 (App Router), React 19, TailwindCSS 4
- Prisma + PostgreSQL, Server-Sent Events
- Playwright 1.57, Midscene.js

## Docs To Read First
- `docs/README.md` - Documentation index and audience split
- `infra/README.md` - Local infra topology and shared deployment dependencies
- `docs/maintainers/coding-agent-maintenance-guide.md` - Runtime invariants and common footguns
- `docs/maintainers/android-runtime-maintenance.md` - Android runtime behavior and isolation model
- `docs/maintainers/runner-queue-diagnostics.md` - Queue debugging and failure tracing
- `docs/maintainers/frontend-runtime-debugging.md` - Frontend/runtime integration debugging
- `docs/maintainers/mcp-server-tooling.md` - MCP tool contracts for registered tools
- `docs/maintainers/test-case-excel-format.md` - Import/export format contract

If changing operator-facing runtime behavior, also read:
- `docs/operators/local-development.md`
- `docs/operators/macos-runner-environment.md`
- `docs/operators/macos-android-runner-guide.md`
- `docs/operators/android-runtime-deployment-checklist.md`

## Docs Structure (Audience Split)
- `docs/operators/` - self-hosting setup and runbooks for operators
- `docs/maintainers/` - technical maintenance references for developers/coding agents
- `infra/` - local service topology and infrastructure references kept in sync with docs

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
- When changing runtime behavior (runner queueing, Android lifecycle, import/export, dispatch), update the relevant docs in `docs/operators/`, `docs/maintainers/`, and `infra/` in the same change series.
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
- `make dev` - Start local control plane with maintenance and browser worker loops
- `make verify` - Run repository verification checks
- `npm run dev` - Start dev server directly
- `npm run lint` - Run ESLint and TypeScript compile checks
- `npm run audit` - Audit lockfile dependencies for moderate/high/critical vulnerabilities
- `npm run verify` - Run lint and audit checks
- `npx prisma studio --schema apps/web/prisma/schema.prisma` - Open DB GUI
- `npx prisma db push --schema apps/web/prisma/schema.prisma` - Apply schema changes

## Common Patterns

### API Endpoint with Auth + Ownership
```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth } from '@/lib/security/auth';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    try {
        const resource = await prisma.testCase.findUnique({
            where: { id },
            include: { project: { select: { userId: true } } }
        });

        if (!resource) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        if (resource.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        return NextResponse.json(resource);
    } catch (error) {
        console.error('Failed:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
```

### Ownership Check for Nested Resources
```typescript
// testRun -> testCase -> project -> user
const testRun = await prisma.testRun.findUnique({
    where: { id },
    include: {
        testCase: {
            include: { project: { select: { userId: true } } }
        }
    }
});

if (!testRun) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

if (testRun.testCase.project.userId !== authPayload.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

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
2. Run `npx prisma db push --schema apps/web/prisma/schema.prisma`
3. Update types in `apps/web/src/types/` if needed
4. Re-export from `apps/web/src/types/index.ts`

## Security Checklist
- [ ] `verifyAuth(request)` called at route start
- [ ] Ownership verified via `project.userId === authPayload.userId`
- [ ] Input validated before database operations
- [ ] Sensitive fields not exposed in responses

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
| i18n messages | `apps/web/src/i18n/messages.ts` (all three locales: en, zh-Hant, zh-Hans) |

## i18n Guidelines
- All user-facing text must use i18n keys via `t('key.path')`
- Add keys to all three locales in `apps/web/src/i18n/messages.ts`
- Keep translations concise; avoid duplicate keys for minor variations
- Use interpolation for dynamic values: `t('key', { name: value })`

## What NOT to Do
- Don't create new Prisma or queue instances
- Don't add `any` types
- Don't hardcode values (use config)
- Don't refactor unrelated code
- Don't skip authentication on API routes
- Don't create duplicate i18n keys for minor text variations
