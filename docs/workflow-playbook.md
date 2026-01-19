# Agentic Workflow Playbook

## Goals
- Align on intent before writing code.
- Keep changes small, reviewable, and reversible.
- Prefer evidence (tests/logs) over guesses.
- Reduce complexity (DRY, YAGNI).

## Workflow

### 1. Align on intent
- Restate the request and success criteria.
- Ask clarifying questions for missing constraints or edge cases.
- Identify impacted files, dependencies, and risks.

### 2. Shape the design (non-trivial work)
- Propose 1–2 approaches with tradeoffs and confirm direction.
- Capture design notes in `docs/plans/YYYY-MM-DD-<slug>-design.md` when behavior or architecture changes.

### 3. Plan the work
- List the files you will touch and the tests you will run.
- If work spans multiple files or more than two steps, write a plan in `docs/plans/YYYY-MM-DD-<slug>.md` (create the directory if missing).
- Keep tasks bite-sized (2–5 minutes each) with exact paths and validation steps.

### 4. Implement with guardrails
- Prefer test-first for new behavior or bug fixes when a test harness exists.
- Keep diffs minimal; avoid opportunistic refactors.
- Use config, singletons, and types per `docs/assistant-guidelines.md`.
- For bugs, reproduce and identify root cause before fixing.
- **Scope freeze for bugfixes:** avoid unrelated refactors/polish (styling, reformatting, queue tweaks) unless explicitly approved.

### 5. Review and verify
- Self-review in two passes: spec compliance first, then code quality.
- Run the most specific validation available; broaden only if needed.
- Do not claim completion without fresh verification evidence.
- Record skipped validation and the reason.

### 6. Handoff
- Summarize changes, tests run, and open questions or follow-ups.
- Pause for confirmation when assumptions or scope change.

## Plan Template

```markdown
# <Feature> Implementation Plan

**Goal:** One-sentence outcome
**Context:** Relevant constraints/assumptions

### Task 1: <Name>
**Files:** `path/to/file.ts`
**Steps:** ...
**Validation:** `npm test ...`
```

## Debugging Checklist
- Reproduce the issue and capture exact errors.
- Capture an evidence pack before changing code:
  - Browser Network log (request sequence, status codes, and one representative response body)
  - Relevant console/server logs
  - Minimal repro steps
- Trace data flow to the root cause.
- Write a failing test or minimal repro.
- Implement the smallest fix and re-verify.

## Commit Rules
- One concern per commit with a clear message.
- Avoid mixing refactors and behavior changes.
- Keep commits reversible and focused.
- Commit after each logical change; don't batch unrelated changes.
- Use conventional commit prefixes: `feat:`, `fix:`, `style:`, `chore:`, `refactor:`.

## Validation Guidance
- Run targeted tests before broader suites.
- Skip heavy tests unless requested; note skips in the summary.
- Run `npx tsc --noEmit` to verify TypeScript compilation before committing.
