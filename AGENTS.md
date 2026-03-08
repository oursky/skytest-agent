# AGENTS.md — Guidelines for Codex

## Project Map
```
src/
├── lib/                    # Backend domain modules + singletons
│   ├── runtime/            # Run lifecycle and execution
│   │   ├── test-runner.ts  # Playwright/Midscene execution engine
│   │   └── usage.ts        # API usage tracking
│   ├── android/            # Android devices/emulators runtime
│   ├── core/               # Shared core modules (prisma/logger/errors)
│   ├── security/           # Authentication + security helpers
│   ├── config/             # Config parsing/validation/sorting
│   └── mcp/                # MCP server/tooling
│
├── app/                    # Next.js App Router
│   ├── api/                # REST API endpoints
│   │   ├── projects/       # Project CRUD
│   │   ├── test-cases/     # Test case CRUD + files + run
│   │   ├── test-runs/      # Run status, cancel, SSE events
│   │   └── user/           # User settings & usage
│   ├── projects/           # Project list & detail pages
│   ├── test-cases/[id]/    # Test case history views
│   └── run/                # Main test runner page
│
├── components/             # React components (feature-first)
│   ├── features/
│   │   ├── test-form/      # Builder + step editing
│   │   │   ├── ui/
│   │   │   ├── model/
│   │   │   └── hooks/
│   │   ├── configurations/ # Target/test config composition
│   │   │   ├── ui/
│   │   │   ├── model/
│   │   │   └── hooks/
│   │   ├── result-viewer/  # Run timeline + status
│   │   │   └── ui/
│   │   ├── project-configs/# Project-level config management
│   │   │   ├── ui/
│   │   │   ├── model/
│   │   │   └── hooks/
│   │   ├── files/          # File upload/list widgets
│   │   │   └── ui/
│   │   └── device-status/  # Android device status presentation
│   │       ├── ui/
│   │       └── model/
│   ├── shared/             # Cross-feature reusable UI
│   └── layout/             # Page-level layout primitives
│
├── types/                  # TypeScript interfaces
│   └── index.ts            # All type exports
│
└── config/app.ts           # App configuration
```

## Task Routing

| Task | Start Here | Related Files |
|------|------------|---------------|
| Fix test execution | `src/lib/runtime/test-runner.ts` | `src/lib/runtime/local-browser-runner.ts`, `cli-runner/runner/index.ts` |
| Fix run scheduling/claiming | `src/lib/runners/claim-service.ts` | `src/app/api/runners/v1/jobs/claim/route.ts` |
| Fix SSE/real-time updates | `src/app/api/test-runs/[id]/events/route.ts` | `src/components/features/result-viewer/ui/ResultViewer.tsx` |
| Fix test case CRUD | `src/app/api/test-cases/` | `src/types/test.ts` |
| Fix project CRUD | `src/app/api/projects/` | `src/lib/core/prisma.ts` |
| Fix authentication | `src/lib/security/auth.ts` | `src/app/api/` |
| Fix UI components | `src/components/` | component-specific |
| Add new API endpoint | `src/app/api/` | `src/types/`, `src/lib/core/prisma.ts` |
| Change DB schema | `prisma/schema.prisma` | `src/types/` |

## Tech Stack
- Next.js 16 (App Router), React 19, TailwindCSS 4
- Prisma + PostgreSQL, Server-Sent Events
- Playwright 1.57, Midscene.js

## Rules
1. **No `any`** - All types in `src/types/index.ts`
2. **Singletons only** - Use `src/lib/core/prisma.ts`, never create new Prisma instances
3. **No hardcoding** - Use `src/config/app.ts`
4. **Minimal diffs** - Change only what's necessary
5. **Match existing style** - No reformatting unrelated code
6. **No destructive git operations without explicit confirmation**
   - Do not run `git restore`, `git checkout -- <file>`, `git reset --hard`, `git clean`, `git rebase`, or force-push without the user's permission.
   - Before any scope cleanup, create a safety snapshot via `git stash push -u -m "wip backup"` or a WIP commit.

## Workflow
- Align on intent and success criteria before coding.
- For non-trivial changes, capture design notes in a focused doc under `docs/maintainers/`.
- For multi-step work, keep a task-by-task implementation checklist in the PR/branch notes.
- Prefer test-first for new behavior; reproduce and trace root causes before fixes.
- Self-review spec compliance first, then code quality; verify before completion claims.
- Run `npm run verify` before committing (lint, TypeScript compile, and dependency audit).

## Code Style
**Code as Documentation**: Write self-explanatory code. Avoid comments unless absolutely necessary.
- Good variable/function names eliminate need for comments
- Only add comments for non-obvious "why" (not "what")
- Never comment obvious code like `// loop through items` or `// validate input`

## Commands
- `npm run dev` - Start dev server
- `npm run lint` - Run ESLint and TypeScript compile checks
- `npm run audit` - Audit lockfile dependencies for moderate/high/critical vulnerabilities
- `npm run verify` - Run lint and audit checks
- `npx prisma studio` - Open DB GUI
- `npx prisma db push` - Apply schema changes

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
1. Edit `prisma/schema.prisma`
2. Run `npx prisma db push`
3. Update types in `src/types/` if needed
4. Re-export from `src/types/index.ts`

## Security Checklist
- [ ] `verifyAuth(request)` called at route start
- [ ] Ownership verified via `project.userId === authPayload.userId`
- [ ] Input validated before database operations
- [ ] Sensitive fields not exposed in responses

## File Placement

| Type | Location |
|------|----------|
| API endpoint | `src/app/api/<resource>/route.ts` |
| Page | `src/app/<path>/page.tsx` |
| Feature component | `src/components/features/<feature>/ui/<Name>.tsx` |
| Feature hooks/model | `src/components/features/<feature>/{hooks,model}/<module>.ts` |
| Shared/Layout component | `src/components/{shared,layout}/<Name>.tsx` |
| Shared logic | `src/lib/<domain>/<module>.ts` |
| Types | `src/types/<category>.ts` + re-export in `index.ts` |
| Config | `src/config/app.ts` |
| i18n messages | `src/i18n/messages.ts` (all three locales: en, zh-Hant, zh-Hans) |

## i18n Guidelines
- All user-facing text must use i18n keys via `t('key.path')`
- Add keys to all three locales in `src/i18n/messages.ts`
- Keep translations concise; avoid duplicate keys for minor variations
- Use interpolation for dynamic values: `t('key', { name: value })`

## What NOT to Do
- Don't create new Prisma instances
- Don't add `any` types
- Don't hardcode values (use config)
- Don't refactor unrelated code
- Don't skip authentication on API routes
- Don't create duplicate i18n keys for minor text variations
