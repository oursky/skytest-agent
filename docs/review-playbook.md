# Review Playbook

## Goals
- Reduce context tokens by reading only relevant files.
- Apply atomic commits for any fixes (see `AGENTS.md`/`CLAUDE.md`).

## Quick Start
1. Identify review type(s): Security, Performance, Reliability/Resilience, Load/Scalability, Storage/Data, Privacy/Compliance, Observability/Operations, Cost/Resource, Dependencies/Supply Chain, Data Structures, Code Quality, Accessibility/UX, AI Safety/Behavior.
2. Open the start files for that review type.
3. Use `rg` to locate hotspots, then read only small slices.

## Review Flow
1. **Spec compliance pass:** Confirm requirements/plan coverage and flag missing or extra behavior.
2. **Code quality pass:** Evaluate maintainability, correctness, tests, and error handling.
3. If spec compliance fails, stop and report before quality notes.

## Review Types & Start Files
- Security: `src/lib/test-runner.ts`, `src/app/api/`, `src/lib/auth.ts`, `src/lib/file-security.ts`, `src/config/app.ts`, `prisma/schema.prisma`.
- Performance: `src/lib/queue.ts`, `src/lib/test-runner.ts`, API route query usage.
- Reliability/Resilience: `src/lib/queue.ts`, SSE routes, timeout/retry settings.
- Load/Scalability: queue concurrency, browser limits, API pagination.
- Storage/Data: `prisma/schema.prisma`, `src/lib/file-security.ts`, export/import routes.
- Privacy/Compliance: API responses, file download/export routes, `prisma/schema.prisma`.
- Observability/Operations: `src/lib/queue.ts`, `src/lib/test-runner.ts`, SSE events, status routes.
- Cost/Resource: `src/lib/usage.ts`, `src/config/app.ts`, model usage tracking.
- Dependencies/Supply Chain: `package.json`, `package-lock.json`.
- Data Structures/Types: `src/types/`, `src/utils/`.
- Code Quality/Maintenance: `src/components/`, `src/lib/` (only what is touched).
- Accessibility/UX: `src/components/` for UI changes.
- AI Safety/Behavior: `src/lib/test-runner.ts`, `src/config/app.ts`, prompt/tool guardrails.

## Output Format
- Findings list with: Severity, Risk, Evidence (file path), Recommendation.
- Separate Spec Compliance findings from Code Quality findings.
- Optional: quick wins and follow-ups.

## Token-Saving Defaults
- Avoid repo-wide scans unless explicitly requested.
- Prefer targeted `rg` and small `read` windows.
