# Refactor Candidates Ranked

Date: 2026-04-03  
Status: Phase 1 initial population

## Ranking Method

Scored by combined impact on reliability/security/maintainability and execution risk.

- Severity: `critical`, `high`, `medium`, `low`
- Effort: `small`, `medium`, `large`, `xlarge`

## Ranked Candidates

| Rank | Area | File or module | Problem summary | Severity | Effort | Risk if unchanged | Suggested phase |
|---|---|---|---|---|---|---|---|
| 1 | Runtime | `apps/web/src/lib/runtime/test-runner.ts` | 1804 LOC hotspot with mixed orchestration, side effects, and lifecycle transitions | critical | xlarge | high regression probability and slow onboarding for runtime fixes | 3a-runtime |
| 2 | MCP | `apps/web/src/lib/mcp/server.ts` | 1199 LOC monolith mixing transport, auth checks, tool routing, and response shaping | critical | xlarge | contract break risk and hard-to-test tool behavior | 3a-mcp |
| 3 | Frontend runtime page | `apps/web/src/app/run/page.tsx` | 1145 LOC page-level orchestration and UI state coupling | high | large | UI regressions and high cognitive load for run-flow changes | 3b |
| 4 | Frontend project page | `apps/web/src/app/projects/[id]/page.tsx` | 1052 LOC with mixed data fetching, orchestration, and rendering concerns | high | large | repeated bugs in project details and slow feature delivery | 3b |
| 5 | Local browser runtime | `apps/web/src/lib/runtime/local-browser-runner.ts` | 987 LOC with queue claim, run control, lease logic, and status transitions intertwined | high | large | duplicate lifecycle bugs and fragile fixes | 3a-runtime |
| 6 | macOS runner engine | `apps/macos-runner/runner/engine.ts` | 957 LOC engine with broad lifecycle/process responsibilities | high | large | contract drift and reliability regressions on runner behavior | 3c |
| 7 | CLI runner manager | `apps/cli/src/runtime/runner-manager.ts` | 715 LOC manager coupling process supervision, IO, protocol, and persistence | high | large | CLI operational brittleness and difficult test isolation | 2b/3c |
| 8 | API auth/ownership boilerplate | `apps/web/src/app/api/**/route.ts` | 65 routes, 45 with repeated auth + ownership + error mapping patterns | high | large | inconsistent security/error handling and high duplication cost | 2a |
| 9 | Runner protocol boundary | `apps/cli/src/runtime/runner-manager.ts`, `apps/macos-runner/runner/engine.ts` | direct `@skytest/runner-protocol/src/*` imports leak internal package structure | high | small | hidden breaking changes when protocol internals shift | 2a |
| 10 | Runner claim complexity | `apps/web/src/lib/runners/claim-service.ts` | complex SQL + policy logic in a single module | high | medium | queue fairness/performance regressions hard to detect | 2b/3a |
| 11 | Android runtime complexity | `apps/web/src/lib/android/emulator-pool.ts`, `apps/web/src/lib/android/device-manager.ts` | large stateful modules with high side-effect density | high | large | instability in device lifecycle under load | 3c |
| 12 | SSE and event path coupling | `apps/web/src/app/api/test-runs/[id]/events/route.ts`, `apps/web/src/lib/runners/event-service.ts` | event ingestion, sequencing, and stream delivery contracts tightly coupled | medium | medium | performance regressions and event consistency issues | 2a/3a |
| 13 | Import/export complexity | `apps/web/src/utils/excel/testCaseExcel.ts`, `apps/web/src/lib/test-cases/batch-import-service.ts` | large conversion logic and edge-case heavy parsing in single modules | medium | medium | silent data-shape drift and import failures | 3b/4 |
| 14 | i18n catalog scalability | `apps/web/src/i18n/locales/*.ts` | large locale files without automated dead-key and parity checks | medium | medium | translation drift and key consistency debt | 4 |
| 15 | Team runners UI complexity | `apps/web/src/components/features/team-runners/ui/TeamRunners.tsx` | high-surface UI module mixing state derivation and rendering | medium | medium | maintainability drag and UI regression risk | 3b |

## Quick-Win Slice Candidates

1. Remove direct protocol subpath imports (candidate 9).
2. Add deny-by-default auth-route check and allowlist enforcement (candidate 8).
3. Add MCP manifest compatibility gate before decomposition (candidate 2).

## Evidence Snapshot

- Top LOC hotspots (TS/TSX): `test-runner.ts` (1804), `mcp/server.ts` (1199), `run/page.tsx` (1145), `projects/[id]/page.tsx` (1052), `local-browser-runner.ts` (987), `engine.ts` (957), `runner-manager.ts` (715)
- API route count: `65`
- Routes using `verifyAuth`: `45`
- Runner-auth routes using `authenticateRunnerRequest`: `13`
- Non-`verifyAuth` exceptional routes: `7` (covered in `plans/auth-route-allowlist.md`)
- Direct protocol subpath import occurrences: `2`
