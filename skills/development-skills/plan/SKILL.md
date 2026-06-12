---
name: plan
description: Create an implementation plan for a task — align on intent, identify impacted files, and write a step-by-step plan. Use when the user asks to plan work, design a feature, create an implementation plan, or tackle a non-trivial change.
---

# Implementation Planning

Align on intent before writing code. Shape the design, identify impacted files, and produce a step-by-step plan with validation steps.

## When to Apply

- User asks to "plan", "design", or "figure out how to implement" something
- Non-trivial changes that touch multiple files or layers
- New features or behavior changes that need upfront alignment
- User wants to understand scope before committing to implementation

## Workflow

### 1. Align on intent

- Restate the request and success criteria in your own words
- Ask clarifying questions for missing constraints or edge cases
- Locate the domain via the Task Routing table in `CLAUDE.md`, and read the matching `docs/maintainers/` reference before planning runtime-adjacent work (runner queueing, Android lifecycle, dispatch, import/export, MCP tooling)
- Identify impacted files, dependencies, and risks
- Identify which architectural layers are involved (data, API, UI, infra, etc.)
- If the change crosses system boundaries, explicitly state the end-state behavior before writing tasks

### 2. Shape the design (non-trivial work)

- Propose 1–2 approaches with tradeoffs and confirm direction
- Default to the simplest design that meets the requirements
- Prefer standard, well-understood patterns over clever solutions
- Don't plan compatibility layers unless they are required for a short-lived migration window

### 3. Write the plan

- List the files you will touch and the tests you will run
- Keep tasks bite-sized (one clear step each) with exact paths and validation steps
- End with a verification task: `npm run verify` (lint, TypeScript compile, dependency audit)
- If the change alters operator-facing runtime behavior, include explicit tasks to update `docs/operators/`, `docs/maintainers/`, and `infra/` in the same change series
- For non-trivial changes, include a task to capture design notes in a focused doc under `docs/maintainers/`
- If the work is part of a larger effort, include:
  - branch strategy
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
**Validation:** How to verify this task is done correctly
```

### 4. Present for approval

Show the plan and wait for user confirmation before implementing.

## Guidelines

- Prefer test-first for new behavior or bug fixes when a test harness exists
- Keep diffs minimal; avoid opportunistic refactors
- For bugs, reproduce and identify root cause before planning the fix
- **Scope freeze for bugfixes**: avoid unrelated refactors/polish unless explicitly approved
- Do not claim completion without fresh verification evidence
- Record skipped validation and the reason
- **Delete superseded paths deliberately**: every plan should say which files or flows will be removed after the new path is validated
- **Git discipline**:
  - large efforts should plan work on a feature/integration branch, not directly on the main branch
  - topic branches should stay short-lived and rebase frequently
  - one plan item should map cleanly to one or more reviewable commits
