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

### 3. Two-pass review

**Pass 1 — Spec compliance**: Confirm requirements/plan coverage. Flag missing or extra behavior. If this pass fails, **stop and report before quality notes.**

**Pass 2 — Code quality**: Evaluate maintainability, correctness, tests, and error handling.

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
