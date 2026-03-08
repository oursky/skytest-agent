---
name: plan
description: Create an implementation plan for a task — align on intent, identify impacted files, and write a step-by-step plan. Use when the user asks to plan work, design a feature, create an implementation plan, or tackle a non-trivial change.
---

# Implementation Planning

Align on intent before writing code. Shape the design, identify impacted files, and produce a step-by-step plan with validation steps.

Plan for the current architecture: a control plane with durable state, browser execution in the control plane, and macOS CLI runners for Android execution.

## When to Apply

- User asks to "plan", "design", or "figure out how to implement" something
- Non-trivial changes that touch multiple files
- New features or behavior changes that need upfront alignment
- User wants to understand scope before committing to implementation

## Workflow

### 1. Align on intent

- Restate the request and success criteria in your own words
- Ask clarifying questions for missing constraints or edge cases
- Identify impacted files, dependencies, and risks
- Identify whether the work touches any of these architectural seams:
  - team membership and ownership rules
  - team-owned OpenRouter key ownership
  - Postgres/object storage
  - runner claiming and leases
  - control-plane browser execution vs macOS Android runner execution
  - MCP auth, scoping, and audit logging
- If it does, explicitly state the end-state behavior before writing tasks

### 2. Shape the design (non-trivial work)

- Propose 1–2 approaches with tradeoffs and confirm direction
- Capture design notes in a focused markdown doc under `docs/maintainers/` when behavior or architecture changes
- Default to the simplest durable design that matches the current target:
  - Postgres instead of SQLite
  - object storage instead of local uploads
  - DB-backed job claiming instead of in-memory queue ownership
  - control-plane APIs instead of host-local runtime checks
  - project/team-owned AI key and usage instead of user-owned key usage
- Do not plan compatibility layers unless they are required for a short-lived refactor safety window

### 3. Write the plan

- List the files you will touch and the tests you will run
- Write the plan in a dedicated markdown file under `docs/maintainers/` when persistent planning notes are needed
- Keep tasks bite-sized (2–5 minutes each) with exact paths and validation steps
- If the work is part of a larger refactor, include:
  - branch name
  - merge order
  - superseded code to delete
  - temporary adapters allowed and their removal step

Use this template:

```markdown
# <Feature> Implementation Plan

**Goal:** One-sentence outcome
**Context:** Relevant constraints/assumptions

### Task 1: <Name>
**Files:** `path/to/file.ts`
**Steps:** ...
**Validation:** `npm test ...`
```

### 4. Present for approval

Show the plan and wait for user confirmation before implementing.

## Guidelines

- Prefer test-first for new behavior or bug fixes when a test harness exists
- Keep diffs minimal relative to the target architecture; avoid opportunistic refactors
- For bugs, reproduce and identify root cause before planning the fix
- **Scope freeze for bugfixes**: avoid unrelated refactors/polish unless explicitly approved
- Do not claim completion without fresh verification evidence
- Record skipped validation and the reason
- **Hard cutover bias**: backward compatibility is optional. Prefer replacing superseded paths instead of preserving them.
- **Delete superseded paths deliberately**: every plan should say which files or flows will be removed after the new path is validated.
- **Git discipline**:
  - large refactors should plan work on the current epic/integration branch, not directly on `main`
  - topic branches should stay short-lived and rebase frequently
  - one plan item should map cleanly to one or more reviewable commits
