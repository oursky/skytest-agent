---
name: review
description: Structured code review with two-pass approach (spec compliance then code quality). Use when the user asks to review code, review a PR, audit changes, check for security/performance/reliability issues, or run a code quality check.
---

# Code Review

Run a structured, token-efficient code review. Two passes: spec compliance first, then code quality. Stop and report if spec compliance fails before moving to quality.

## When to Apply

- User asks to "review", "audit", "check", or "look over" code or a PR
- User asks for a specific review type (security, performance, etc.)
- User asks to review changes against a plan or spec

## Workflow

### 1. Identify review type(s)

Pick one or more from: Security, Performance, Reliability/Resilience, Load/Scalability, Storage/Data, Privacy/Compliance, Observability/Operations, Cost/Resource, Dependencies/Supply Chain, Data Structures, Code Quality, Accessibility/UX, AI Safety/Behavior.

If the user doesn't specify, infer from the changes being reviewed.

For this repo, also explicitly check whether the change is consistent with the target architecture:
- control plane on k8s
- Postgres and object storage
- hosted browser runner
- macOS-only Android runner
- team membership model
- team-owned OpenRouter key and project-scoped usage
- control-plane-only MCP

### 2. Locate start files

Use the review type to pick targeted entry points — don't scan the whole repo:

- **Security**: auth modules, API routes, file handling, config, DB schema
- **Performance**: queue/job processing, execution engines, API route query usage
- **Reliability/Resilience**: queue processing, SSE routes, timeout/retry settings
- **Load/Scalability**: queue concurrency, browser/resource limits, API pagination
- **Storage/Data**: DB schema, file security, export/import routes
- **Privacy/Compliance**: API responses, file download/export routes, DB schema
- **Observability/Operations**: queue processing, execution engines, SSE events, status routes
- **Cost/Resource**: usage tracking, config, model usage tracking
- **Dependencies/Supply Chain**: `package.json`, `package-lock.json`
- **Data Structures/Types**: type definitions, utilities
- **Code Quality/Maintenance**: only files touched by the change
- **Accessibility/UX**: UI components for UI changes
- **AI Safety/Behavior**: execution engines, config, prompt/tool guardrails

Additional repo-specific starting points:
- **Auth/Permissions**: `src/lib/security/auth.ts`, permission helpers, team/project membership routes
- **Runners**: `src/lib/runners/`, `src/runners/`, runner APIs
- **Storage**: Prisma schema, storage adapters, file APIs
- **MCP**: `src/app/api/mcp/route.ts`, `src/lib/mcp/server.ts`
- **Desktop**: `desktop/`

### 3. Two-pass review

**Pass 1 — Spec compliance**: Confirm requirements/plan coverage. Flag missing or extra behavior. If this pass fails, **stop and report before quality notes.**

**Pass 2 — Code quality**: Evaluate maintainability, correctness, tests, and error handling.

Spec compliance for this repo should explicitly ask:
- Did the change preserve or reintroduce local-only assumptions?
- Did the change leave obsolete compatibility code behind?
- Did the change put ownership and billing at project/team level where required?
- Did the change use durable storage/state instead of process memory?

### 4. Output format

Structure findings as:

```
## Spec Compliance

| # | Severity | Risk | Evidence (file:line) | Recommendation |
|---|----------|------|---------------------|----------------|
| 1 | High     | ...  | `src/lib/auth.ts:42` | ...            |

## Code Quality

| # | Severity | Risk | Evidence (file:line) | Recommendation |
|---|----------|------|---------------------|----------------|
| 1 | Medium   | ...  | `src/lib/queue.ts:15` | ...           |

## Quick Wins (optional)
- ...

## Follow-ups (optional)
- ...
```

## Token-Saving Defaults

- Avoid repo-wide scans unless explicitly requested
- Prefer targeted search and small read windows
- Read only relevant files — don't read everything in a directory
- Use `git diff` to scope changes when reviewing a PR or recent work

## Review Biases For Current Practice

- Prefer deletion of obsolete code over preserving compatibility layers
- Flag any new code that:
  - depends on SQLite
  - depends on local uploads as the source of truth
  - depends on in-memory queue or in-memory event fanout
  - checks Android availability from the API host instead of runner capability
  - stores OpenRouter key at user level when team ownership is required
  - introduces unscoped MCP auth or non-audited MCP write paths
