---
name: plan
description: Create an implementation plan for a task — align on intent, identify impacted files, and write a step-by-step plan. Use when the user asks to plan work, design a feature, create an implementation plan, or tackle a non-trivial change.
---

# Implementation Planning

Align on intent before writing code. Shape the design, identify impacted files, and produce a step-by-step plan with validation steps.

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

### 2. Shape the design (non-trivial work)

- Propose 1–2 approaches with tradeoffs and confirm direction
- Capture design notes in `docs/plans/YYYY-MM-DD-<slug>-design.md` when behavior or architecture changes

### 3. Write the plan

- List the files you will touch and the tests you will run
- Write the plan in `docs/plans/YYYY-MM-DD-<slug>.md` (create the directory if missing)
- Keep tasks bite-sized (2–5 minutes each) with exact paths and validation steps

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
- Keep diffs minimal; avoid opportunistic refactors
- For bugs, reproduce and identify root cause before planning the fix
- **Scope freeze for bugfixes**: avoid unrelated refactors/polish unless explicitly approved
- Do not claim completion without fresh verification evidence
- Record skipped validation and the reason
