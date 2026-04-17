# Agent Session Rules

**Audience:** Any coding agent working in this repo (Claude Code, Codex, or otherwise). Humans should also follow these rules, but they exist primarily to keep agents inside guardrails the harness cannot infer.

The rules below override any default agent behavior and must take priority over the agent's built-in tendencies. Each rule exists because of a specific past failure — they are not aesthetic preferences.

---

## Rule 1 — Verify attribution

When `npm run verify` fails, you MUST attribute the failure by the exact failing checker name. The checkers are:

- `lint` (ESLint + TypeScript compile)
- `auth:check-routes`
- `protocol:check-boundary`
- `quality:check-client-imports`
- `quality:check-hotspots`
- `quality:check-config-i18n`
- `quality:check-runner-contracts`
- `quality:check-overrides-drift`
- `audit`
- `security:check-lockfile-floors`

If you do not know which one failed, run:

```bash
npm run --workspace @skytest/web verify:explain
```

It re-runs verify and prints a `VERIFY_FAILURE` block naming the checker. You MUST NOT describe a failure as "pre-existing", "unrelated", or "React hooks lint" etc. based on guesses. Name the checker, quote the first error line, or say you don't know and investigate further.

**Incident basis:** Codex dismissed a `quality:check-hotspots` failure as "pre-existing React hooks lint errors" and shipped a broken `main`.

---

## Rule 2 — Hotspot awareness

Before adding lines to a source file (`apps/web/src/**`, `apps/cli/src/**`, `apps/macos-runner/runner/**`, `packages/runner-protocol/src/**`):

1. Run `wc -l <file>`.
2. If the file is **≥ 855 lines** (95% of the 900 cap), extract a seam *before* adding. Do not stack new logic on top of a file already in the creep band.
3. If the file is **≥ 900 lines and ADR-exempted**, extract anyway when you can; do not add more.

The `quality:check-hotspots` script prints warnings when a file in the creep band grows vs `origin/main`. In CI with `STRICT_HOTSPOT_CREEP=1`, these warnings become errors.

**Incident basis:** `local-browser-runner.ts` drifted 866 → 906 in commit `b528a46` because the author added AI-key validation to an already-hot file without extracting.

---

## Rule 3 — Override and dependency work

Any time you edit an `overrides` block in `package.json` or `apps/web/package.json`, or pin a transitive dependency, follow `docs/maintainers/dependency-upgrade-protocol.md`. In short:

1. Reproduce the override shape in `mktemp -d` **before** editing the real tree.
2. Prefer top-level or parent-scoped overrides; avoid version-scoped (`@pkg@x.y.z`) keys.
3. Keep root and `apps/web` overrides in sync for shared keys (enforced by `quality:check-overrides-drift`).
4. Run `security:check-lockfile-floors` before declaring the work done.
5. Do NOT hand-edit `package-lock.json` with `node -e` to delete subtrees.

**Incident basis:** Codex spent ~15 minutes thrashing through override syntaxes against the real tree, then ended with manual lockfile surgery that future `npm install --force` can undo.

---

## Rule 4 — Commit hygiene on broken base

Before starting work on top of the current `HEAD`:

```bash
git status
npm run verify   # or verify:explain
```

If either shows the base is broken:

- Stop.
- Report the specific failing checker and first error line.
- Ask the user whether to fix the base first or work on a different branch.

Do NOT commit new work on top of a red base without explicit acknowledgement. A clean branch with broken base produces a misleading PR where your commits appear to break CI.

---

## Rule 5 — Force-push to shared branches

Never force-push to `main`, `master`, or any branch tracked by multiple collaborators. Even when asked:

- Warn explicitly that force-push rewrites shared history.
- Ask the user to confirm once more before proceeding.
- If the user says "I'll force-push myself" or equivalent, let them. Don't pre-push, don't stage a push command.

For your own branches (e.g. `harness/<name>`) force-push is fine without this ceremony.

---

## Rule 6 — Destructive git operations

Do not run without explicit user approval:

- `git reset --hard`
- `git clean -fd`
- `git restore <file>` / `git checkout -- <file>` when the file has uncommitted changes
- `git rebase -i` / `git rebase --onto`
- `git push --force`
- `git branch -D`

If you need to discard local changes, prefer `git stash push -u -m "wip backup"` first so the user can recover.

---

## Rule 7 — Minimal diff, verified

Ship the smallest diff that solves the stated problem. Before claiming completion:

- Run `npm run verify` (not just lint).
- If tests exist for the touched files, run them.
- Report what changed, what you ran, and what you verified. If you did not run something, say so explicitly.

Do not refactor unrelated code. Do not reformat files the task did not touch. Do not add speculative error handling. Do not create new documentation files unless the task asked for them.

---

## Agent-specific notes

- **Claude Code** reads `CLAUDE.md` at session start. This rules file is linked from there.
- **Codex** should be pointed at this file via its own instructions / context. When working in this repo, Codex must load this file before starting any task.
- **Both** should cite the relevant rule number when they decline a user request that would violate one (e.g. "Rule 5: I'll warn about force-push to main first").

---

## Changing these rules

These rules are the product of specific incidents. Before changing one:

1. Identify which incident created it (see "Incident basis" lines).
2. Propose the change with the user.
3. If the user agrees, update this file AND add a line explaining what replaced the rule and why.
