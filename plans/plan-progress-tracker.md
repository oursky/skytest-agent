# Plan Progress Tracker

Date: 2026-04-03  
Plan: `plans/2026-04-03-architecture-sustainability-review-plan.md`

## Completion Audit

### Phase 0
- status: complete
- notes: all seven required artifacts exist and phase checkpoint sign-off is documented.

### Phase 1
- status: complete
- notes:
  - review matrix fully populated for all 364 tracked TS/TSX files (`review_status=reviewed`)
  - ranked refactor candidates populated
  - runner-protocol contract audit completed

### Phase 2a
- status: complete
- notes:
  - standardized API guard/response interfaces are in use
  - deny-by-default auth coverage gate is enforced in `npm run verify`
  - direct `@skytest/runner-protocol/src/*` imports removed
  - protocol boundary recurrence gate is enforced in `npm run verify`
  - API dedup expanded from project-config pilot to additional project test-case/config route groups using `guardProjectRouteRequest`
  - API dedup expanded beyond project routes with `guardTeamRouteRequest` across 10 `teams/[id]/**` route files
  - auth-route coverage gate recognizes `guardTeamRouteRequest` as a standardized route guard

### Phase 2b
- status: complete
- notes:
  - runtime/macOS/CLI decomposition scopes documented
  - runtime seam extraction shipped in `test-runner.ts` and `local-browser-runner.ts`
  - CLI runner manager decomposition shipped:
    - control-plane credential reconciliation extracted to `apps/cli/src/runtime/runner-credential-reconcile.ts`
    - process bootstrap/supervision extracted to `apps/cli/src/runtime/runner-process-supervision.ts`
    - `apps/cli/src/runtime/runner-manager.ts` reduced to 500 LOC
  - CLI/macOS/web alignment now uses shared protocol defaults:
    - `RUNNER_MINIMUM_VERSION`
    - `RUNNER_DEFAULT_CAPABILITIES`
    - `RUNNER_DEFAULT_TRANSPORT`
  - integration check added in `apps/web/src/lib/runners/__tests__/protocol.test.ts`

### Phase 3a
- status: complete
- notes:
  - runtime hotspot decomposition slices merged (`local-browser-runner` under 900 LOC)
  - staged Android runtime helper extraction merged from `test-runner.ts` into `apps/web/src/lib/runtime/android-runtime-helpers.ts`
  - Playwright/runtime step execution seams extracted from `test-runner.ts` into:
    - `apps/web/src/lib/runtime/playwright-code-execution.ts`
    - `apps/web/src/lib/runtime/execution-files.ts`
    - `apps/web/src/lib/runtime/assertion-verifier.ts`
  - MCP manifest compatibility snapshot gate added and passing
  - MCP server decomposition completed:
    - `apps/web/src/lib/mcp/server.ts` reduced to 584 LOC
    - create/update tool registrations extracted to `apps/web/src/lib/mcp/test-case-mutation-tools.ts`

### Phase 3b
- status: complete
- notes:
  - `apps/web/src/app/run/page.tsx` reduced to 894 LOC
  - `apps/web/src/app/projects/[id]/page.tsx` reduced to 894 LOC
  - orchestration/state helper extractions merged for import/export, import review, and table/batch operations

### Phase 3c
- status: complete
- notes:
  - macOS runner engine decomposition slice merged (`engine.ts` at 898 LOC)
  - overlap-prevention reliability check automated via `apps/macos-runner/runner/__tests__/process-lock.test.ts`
  - process-lock tests validate stale-lock recovery, single-owner enforcement, and cleanup release behavior
  - worker loop utility extraction merged in `apps/web/src/workers/loop-utils.ts` and adopted by `browser-runner.ts` / `runner-maintenance.ts`
  - runner maintenance loop now isolates single-cycle failures and continues subsequent cycles with bounded retry backoff

### Phase 4
- status: complete
- notes:
  - hotspot LOC gate active with ADR exception registry (`plans/adr-loc-exceptions.json`)
  - runner protocol boundary gate active (`protocol:check-boundary`)
  - auth deny-by-default gate active (`auth:check-routes`)
  - additional runner contract centralization gate added (`quality:check-runner-contracts`)
  - runner event ingestion load-gate script added (`apps/web/scripts/load-gate/runner-events.k6.js`)
  - SSE load-gate implementation added (`apps/web/scripts/load-gate/gate-sse-events.ts`) with smoke/standard/stress npm commands
  - maintainer docs refreshed in `docs/maintainers/coding-agent-maintenance-guide.md`

## Final Status

All plan phases are complete.  
Remaining ADR LOC exception is limited to `apps/web/src/lib/runtime/test-runner.ts` (1122 LOC after staged extraction) with explicit justification and follow-up expiry task.
