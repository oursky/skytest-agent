---
name: commit
description: Plan logical commit units from staged changes only, suggest commit titles, return the plan only, and create commits only after user approval (e.g. "ok", "please commit"). Use when the user asks to commit changes, plan/split commits, create logical commits, or use a refs footer (e.g. refs: SKY-123, #42).
---

# Commit Planning and Splitting

When the user wants to commit **staged** changes (optionally with a footer like `refs: SKY-123, #42`), plan logical units from the **staged set only**, suggest titles, and—**only after approval**—create commits in dependency order. Unstaged and untracked files are ignored.

## Plan only until approved

- **On the commit/plan command**: Return **only the plan** (units, titles, files, footer). Do **not** run `git add` or `git commit`. Stop after showing the plan.
- **Commits require approval**: Run `git add` / `git commit` **only** when the user has sent an **approval signal** in a later message.
- **Approval signals**: Treat as approval and then create the commits when the user says things like: "ok", "please commit", "go ahead", "approved", "yes", "do it", "execute", or equivalent.
- **Flow**: First reply = plan + "Reply with 'ok' or 'please commit' to create these commits." After the user replies with an approval signal, create the commits and report.

## When to Apply

- User asks to "commit", "plan commits", "split into logical commits", or "change the staged changes and plan the order of commits"
- User provides a message footer (e.g. `refs: SKY-123, #42`) to append to every commit
- User has **staged** changes and wants to commit only those (or split them into multiple commits)

## Workflow

### Phase A — Plan (run on commit/plan command; then stop)

### 1. Inspect staged changes only

- **Only consider staged files.** The user is expected to want to commit only what they've already staged. Ignore unstaged and untracked changes.
- Run `git status` and `git diff --cached --stat` (or `git diff --cached --name-only`) to see **staged** files only.
- List only the modified, added, or deleted files that appear in the staged set. If nothing is staged, report that and stop.

### 2. Unstage if re-grouping

- If the user asked to "change the current staged changes" or "plan the order" (re-group the same staged set into multiple commits), run `git reset HEAD` so you can later stage per unit. The plan still uses **only the files that were staged** before the reset.

### 3. Plan units and order

Group **only the staged files** into **commit units** in **dependency order** (things that other units depend on come first). Do not include unstaged or untracked files in the plan.

| Priority | Unit type | Typical files |
|----------|-----------|---------------|
| 1 | Schema / data layer | `prisma/schema.prisma`, `src/types/` |
| 2 | Shared / foundations | `src/lib/` helpers, shared utilities |
| 3 | API routes / config | `src/app/api/` route files, `src/config/app.ts` |
| 4 | Feature A | API route, **components that page uses**, **i18n keys those components use** (`src/i18n/messages.ts`), tests |
| 5 | Feature B | API route, components, tests (reuse shared lib/types from earlier unit) |
| 6 | Docs / tooling | README, Storybook stories, etc. |

- One logical unit = one commit
- Order so that no commit depends on a later commit (e.g. shared lib before API routes that import it; types before components that use them)
- **Co-locate UI with its dependencies**: Components **and i18n** must be committed in the **same unit** as the page/layout that renders them. Do not put a shared component in an earlier commit and the page that renders it in a later one; do not put a component in one commit and the i18n keys it uses (`t("...")` from `src/i18n/messages.ts`) in another — group each UI surface with all the pieces it needs, including **i18n entries** for every key that surface references

### 4. Suggest commit title per unit

- **Title**: Short, imperative, no period (e.g. "Add TestCase tag schema and types", "Add tag filtering to project view")
- **Body** (optional): Bullet points for non-trivial units
- **Footer**: If the user gave one (e.g. `refs: SKY-123, #42`), use the same footer on every commit

### 5. Show the plan, then stop

Output:

- Numbered list of units with **suggested title** and **files**
- Footer line if provided
- **Stop.** Do not run Phase B. Add: "Reply with 'ok' or 'please commit' to create these commits."

Example:

```
| # | Suggested title                         | Files |
|---|-----------------------------------------|-------|
| 1 | Add tag schema and types                | prisma/schema.prisma, src/types/tag.ts, src/types/index.ts |
| 2 | Add tag API routes                      | src/app/api/tags/route.ts, src/app/api/test-cases/[id]/tags/route.ts |
| 3 | Add tag UI to test case page            | src/components/TagPicker.tsx, src/app/test-cases/[id]/page.tsx, src/i18n/messages.ts (tags.* keys) |
| 4 | Add tag filtering to project view       | src/components/TagFilter.tsx, src/app/projects/[id]/page.tsx |

Footer: refs: SKY-42

Reply with 'ok' or 'please commit' to create these commits.
```

**Do not run `git add` or `git commit` in Phase A.**

---

### Phase B — Execute (run only after user sends an approval signal)

When the user replies with an approval signal ("ok", "please commit", "go ahead", "approved", "yes", "do it", "execute", or equivalent), then:

### 6. Create commits in order

For each unit, in order (each unit contains only files from the originally staged set):

1. `git add <files>` for that unit only (only files that were staged and assigned to this unit)
2. Build message:
   - First line: suggested title
   - Blank line
   - Optional body (bullets)
   - Blank line (if body present)
   - Footer line if user provided it (e.g. `refs: SKY-123, #42`)
3. `git commit -m "<title>" [-m "<body>" -m "<footer>"]`
   Use multiple `-m` for body and footer so they become separate paragraphs.

### 7. Report

- Print `git log --oneline -<N>` for the new commits
- Confirm working tree is clean or list what's left uncommitted (e.g. untracked `.codex/`)

## Commit message format

```
<Suggested title>

[Optional body lines]

refs: SKY-123, #42
```

- **Title**: One line, imperative, ~50 chars or less
- **Body**: Optional; use for "why" or short bullet list
- **Footer**: Exact string the user gave; one line, same on every commit

## Guidelines

- **Staged only**: Plan and commit **only** from the set of files that are currently staged. Ignore unstaged and untracked changes. The user is expected to want to commit only what they've staged. If nothing is staged, report that and stop.
- **Plan first, commit after approval**: On the commit/plan command, output only the plan and ask for approval. Run `git add` / `git commit` only when the user sends an approval signal ("ok", "please commit", "go ahead", "approved", "yes", "do it", "execute").
- **One commit per unit**: Each unit is one logical change
- **Dependency order**: Foundations and shared code before features that use them
- **Co-locate UI with its dependencies**: Always commit components **and i18n** in the **same unit** as the page/layout that renders them. Do not split "shared component" into an earlier commit and "page that renders it" into a later one; do not split "component" and "i18n entries that component uses" into separate commits — group each UI surface with all the pieces it needs (components, i18n keys from `src/i18n/messages.ts`). Shared items used by more than one UI go in the unit for the **first** UI that uses them.
- **Same footer everywhere**: If the user specifies a footer, add it to every new commit in this run
- **Skip unrelated paths**: Do not commit untracked tooling (e.g. `.codex/`) unless the user asks
- **Repo root**: Run `git` from the repository root

## Example plan

Test case tagging feature — a typical order (components co-located with the page that uses them, including i18n):

1. **Add tag schema and types** — `prisma/schema.prisma`, `src/types/tag.ts`, re-export in `src/types/index.ts`
2. **Add tag API routes** — `src/app/api/tags/route.ts`, `src/app/api/test-cases/[id]/tags/route.ts`
3. **Add tag UI to test case page** — `src/components/TagPicker.tsx`, `src/app/test-cases/[id]/page.tsx` (renders TagPicker), **i18n** (`src/i18n/messages.ts` for `tags.*` keys used by TagPicker)
4. **Add tag filtering to project view** — `src/components/TagFilter.tsx`, `src/app/projects/[id]/page.tsx` (renders TagFilter, reuses types/API from earlier units)

Footer: `refs: SKY-42`
