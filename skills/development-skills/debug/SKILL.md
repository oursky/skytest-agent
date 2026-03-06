---
name: debug
description: Structured debugging workflow — reproduce first, gather evidence, trace root cause, fix with minimal scope. Use when the user asks to debug, investigate, trace, or fix a bug.
---

# Debugging Workflow

Reproduce the issue, gather evidence, trace the root cause, then apply the smallest fix. No guessing, no unrelated changes.

## When to Apply

- User asks to "debug", "investigate", "trace", or "fix" a bug
- Something is broken and the cause isn't immediately obvious
- User reports unexpected behavior

## Workflow

### 1. Reproduce the issue

- Get exact error messages and repro steps
- Reproduce the issue yourself before changing any code

### 2. Gather an evidence pack

Before changing code, capture:

- Browser Network log (request sequence, status codes, and one representative response body) if applicable
- Relevant console/server logs
- Minimal repro steps
- For platform/runtime bugs, also capture the system boundary involved:
  - control plane API
  - browser runner
  - macOS runner
  - Postgres state
  - object storage state
  - Authgear token or project membership context

### 3. Trace the root cause

- Trace data flow from the symptom to the root cause
- Don't guess — follow the evidence through the code
- Prefer tracing through service boundaries, not just component code:
  - request -> permission check -> service -> DB/object storage -> runner/event ingestion
- If the bug is in a legacy path that is scheduled for removal, confirm whether the correct fix is deletion rather than patching

### 4. Write a failing test

- Write a failing test or minimal repro that demonstrates the bug
- Skip only if the project has no test harness; note the skip
- For runner bugs, a deterministic service or API-level repro is preferred over flaky end-to-end automation

### 5. Apply the smallest fix

- Implement the minimal fix that addresses the root cause
- Re-verify the fix passes the failing test and doesn't break existing tests
- If the bug is caused by old local-first assumptions, the smallest correct fix may be to route the call through the new durable service and delete the old path

### 6. Report

- Summarize: root cause, fix applied, tests run
- Note any follow-ups or related issues discovered

## Guidelines

- **Scope freeze**: Do not fix unrelated issues, refactor surrounding code, or add polish. Only fix the reported bug.
- **Evidence over guesses**: Always trace, never assume
- **Safety snapshot**: Before any scope cleanup, create a backup via `git stash push -u -m "wip backup"` or a WIP commit
- **No destructive git operations** (`git restore`, `git checkout -- <file>`, `git reset --hard`, `git clean`, `git rebase`, force-push) without explicit user permission
- **Architecture-aware fixes**:
  - do not reintroduce in-memory queue ownership
  - do not add new SQLite-specific logic
  - do not add new user-level OpenRouter key behavior if the project-level path is the target
  - do not patch MCP by reading local Android state on the server when runner inventory should be used
