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
- **Performance**: hot paths, query-heavy code, loops, caching layers
- **Reliability/Resilience**: error handling, retry logic, timeout/retry settings, queue processing
- **Load/Scalability**: concurrency limits, resource pools, pagination, batch processing
- **Storage/Data**: DB schema, migrations, file handling, import/export
- **Privacy/Compliance**: API responses, data exposure, export routes, PII handling
- **Observability/Operations**: logging, metrics, health checks, status endpoints
- **Cost/Resource**: usage tracking, external API calls, resource allocation
- **Dependencies/Supply Chain**: `package.json`, lock files, dependency versions
- **Data Structures/Types**: type definitions, interfaces, shared models
- **Code Quality/Maintenance**: only files touched by the change
- **Accessibility/UX**: UI components, form handling, keyboard navigation
- **AI Safety/Behavior**: prompt construction, tool use, guardrails, model config

### 3. Two-pass review

**Pass 1 — Spec compliance**: Confirm requirements/plan coverage. Flag missing or extra behavior. If this pass fails, **stop and report before quality notes.**

**Pass 2 — Code quality**: Evaluate maintainability, correctness, tests, and error handling.

### 4. Output format

Structure findings as:

```
## Spec Compliance

| # | Severity | Risk | Evidence (file:line) | Recommendation |
|---|----------|------|---------------------|----------------|
| 1 | High     | ...  | `src/auth.ts:42`    | ...            |

## Code Quality

| # | Severity | Risk | Evidence (file:line) | Recommendation |
|---|----------|------|---------------------|----------------|
| 1 | Medium   | ...  | `src/handler.ts:15` | ...            |

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
