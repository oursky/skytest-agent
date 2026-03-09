# Commit Planning and Splitting

When the user wants to commit **staged** changes (optionally with a footer like `refs: #42`), plan logical units from the **staged set only**, suggest titles, and—**only after approval**—create commits in dependency order. Unstaged and untracked files are ignored.

## Plan only until approved

- **On the commit/plan command**: Return **only the plan** (units, titles, files, footer). Do **not** run `git add` or `git commit`. Stop after showing the plan.
- **Commits require approval**: Run `git add` / `git commit` **only** when the user has sent an **approval signal** in a later message.
- **Approval signals**: Treat as approval and then create the commits when the user says things like: "ok", "please commit", "go ahead", "approved", "yes", "do it", "execute", or equivalent.
- **Flow**: First reply = plan + "Reply with 'ok' or 'please commit' to create these commits." After the user replies with an approval signal, create the commits and report.

## When to Apply

- User asks to "commit", "plan commits", "split into logical commits", or "change the staged changes and plan the order of commits"
- User provides a message footer (e.g. `refs: #42`) to append to every commit
- User has **staged** changes and wants to commit only those (or split them into multiple commits)

## Workflow

### Phase A — Plan (run on commit/plan command; then stop)

### 1. Inspect staged changes only

- **Only consider staged files.** Ignore unstaged and untracked changes.
- Run `git status` and `git diff --cached --stat` (or `git diff --cached --name-only`) to see **staged** files only.
- If nothing is staged, report that and stop.

### 2. Unstage if re-grouping

- If the user asked to "change the current staged changes" or "plan the order" (re-group the same staged set into multiple commits), run `git reset HEAD` so you can later stage per unit. The plan still uses **only the files that were staged** before the reset.

### 3. Plan units and order

Group **only the staged files** into **commit units** in **dependency order** (things that other units depend on come first).

| Priority | Unit type | Typical files |
|----------|-----------|---------------|
| 1 | Schema / data layer | Database migrations, model definitions, type definitions |
| 2 | Shared / foundations | Library code, shared utilities, helpers |
| 3 | Configuration | Config files, environment setup, build config |
| 4 | API / backend logic | API routes, services, middleware |
| 5 | UI / frontend | Components, pages, styles, i18n/localization |
| 6 | Tests | Unit tests, integration tests, test fixtures |
| 7 | Docs / tooling | Documentation, CI config, scripts |

- One logical unit = one commit
- Order so that no commit depends on a later commit (e.g. shared lib before code that imports it; types before components that use them)
- **Co-locate UI with its dependencies**: Components and their directly related assets (styles, i18n keys, etc.) should be in the **same unit** as the page or feature that uses them
- If a commit deletes obsolete code, keep that deletion in the same unit as the replacement when reviewable

### 4. Suggest commit title per unit

- **Title**: Short, imperative, no period (e.g. "Add user profile schema and types", "Add tag filtering to project view")
- **Body** (optional): Bullet points for non-trivial units
- **Footer**: If the user gave one (e.g. `refs: #42`), use the same footer on every commit

### 5. Show the plan, then stop

Output:

- Numbered list of units with **suggested title** and **files**
- Footer line if provided
- **Stop.** Do not run Phase B. Add: "Reply with 'ok' or 'please commit' to create these commits."

Example:

```
| # | Suggested title                         | Files |
|---|-----------------------------------------|-------|
| 1 | Add tag schema and types                | db/migrations/..., src/types/tag.ts |
| 2 | Add tag API routes                      | src/api/tags/route.ts, src/api/items/tags/route.ts |
| 3 | Add tag UI to item detail page          | src/components/TagPicker.tsx, src/pages/items/detail.tsx |

Footer: refs: #42

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
   - Footer line if user provided it (e.g. `refs: #42`)
3. `git commit -m "<title>" [-m "<body>" -m "<footer>"]`
   Use multiple `-m` for body and footer so they become separate paragraphs.

### 7. Report

- Print `git log --oneline -<N>` for the new commits
- Confirm working tree is clean or list what's left uncommitted

## Commit message format

```
<Suggested title>

[Optional body lines]

refs: #42
```

- **Title**: One line, imperative, ~50 chars or less
- **Body**: Optional; use for "why" or short bullet list
- **Footer**: Exact string the user gave; one line, same on every commit

## Guidelines

- **Staged only**: Plan and commit **only** from the set of files that are currently staged. Ignore unstaged and untracked changes. If nothing is staged, report that and stop.
- **Plan first, commit after approval**: On the commit/plan command, output only the plan and ask for approval. Run `git add` / `git commit` only when the user sends an approval signal.
- **One commit per unit**: Each unit is one logical change
- **Dependency order**: Foundations and shared code before features that use them
- **Co-locate UI with its dependencies**: Always commit components and their related assets (styles, i18n, etc.) in the **same unit** as the page/feature that uses them. Shared items used by more than one feature go in the unit for the **first** feature that uses them.
- **Same footer everywhere**: If the user specifies a footer, add it to every new commit in this run
- **Skip unrelated paths**: Do not commit untracked tooling files unless the user asks
- **Repo root**: Run `git` from the repository root
