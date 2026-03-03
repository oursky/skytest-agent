# Sustainability Refactor Design (2026-03-03)

## Goal
Improve maintainability and reliability by fixing high-risk defects in `src/lib`, reducing long-file complexity through focused modularization, and making timing/security behavior configurable and testable.

## Scope
- In scope:
  - `src/lib` correctness/security fixes identified in review
  - modularization of longest/highest-complexity files in `src/lib`
  - modularization seams for highest-impact long scripts outside `src/lib`
- Out of scope:
  - feature behavior changes beyond reliability/security hardening
  - UI redesign
  - broad database schema changes

## Findings-to-Fix Mapping
1. Queue cancellation can leak a running slot when cleanup fails.
2. MCP create/update writes are non-transactional and can partially persist.
3. Playwright code execution relies on brittle statement splitting.
4. Android shell commands interpolate package IDs without strict validation.
5. JSON parsing from DB string fields is unguarded.
6. Emulator pool behavior does not align with pooling/reuse intent.
7. Hardcoded timing constants reduce operational tunability.

## Design Decisions

### 1) Queue cancellation safety first
- Keep current queue architecture (singleton and scheduling semantics).
- Ensure cancellation always transitions in-memory state out of `running` even if cleanup throws.
- Keep cleanup callback execution, but decouple slot release from cleanup success.

### 2) MCP persistence atomicity
- Wrap multi-step create/update mutations in `prisma.$transaction`.
- Keep current API shape and warning semantics.
- Avoid deep handler redesign; extract helper functions only where needed to reduce risk.

### 3) Playwright code execution simplification
- Remove heuristic per-statement splitting and run one sandboxed async block per code step.
- Preserve safety guardrails:
  - blocked token validation
  - restricted context (`page`, `expect`, timer wrappers)
  - setInputFiles path policy via proxied page
  - hard timeout with timer cleanup
- Keep screenshot capture at step granularity to avoid behavior regressions.

### 4) Android package/app ID validation
- Introduce strict Android package name validator and enforce before shell command interpolation.
- Fail early with clear configuration error.

### 5) Safe JSON parsing
- Add defensive parsing utility with fallback and logging context.
- Preserve return contract in `parseTestCaseJson`.

### 6) Emulator pool true pooling behavior
- Reuse healthy idle emulator matching requested AVD/launch mode.
- On release after successful cleanup, return to `IDLE` and re-arm idle/health timers instead of unconditional stop.
- Stop only on cleanup/health failure or explicit stop/timeout reclaim.

### 7) Config-driven timing
- Replace hardcoded values in queue/test-runner where possible with `config` values.
- Keep defaults in `src/config/app.ts` to preserve current behavior unless changed.

## Modularization Plan

### `src/lib/test-runner.ts`
Extract to `src/lib/test-runner/`:
- `android-ops.ts` (device/app foreground, launch, recover, permissions)
- `playwright-sandbox.ts` (safe page proxy + code execution)
- `step-execution.ts` (AI/code step execution orchestrator)
- `artifacts.ts` (screenshots + cleanup helpers)
- `types.ts` (local helper interfaces)

### `src/lib/queue.ts`
Extract to `src/lib/queue/`:
- `status-sync.ts` (testRun/testCase/project event status updates)
- `android-reservations.ts` (reservation/probe helpers)
- `event-persistence.ts` (event chunk serialization + persistence scheduling)

### `src/lib/mcp-server.ts`
Extract to `src/lib/mcp/`:
- `result.ts` (text/error result helpers)
- `authz.ts` (user extraction + ownership checks)
- `android-selector.ts` (device selector resolution)
- `test-case-configs.ts` (config upsert/remove helpers)

### `src/lib/emulator-pool.ts`
Extract to `src/lib/emulator-pool/`:
- `process-lifecycle.ts` (spawn/kill/wait)
- `adb-discovery.ts` (ports/serial discovery)
- `state.ts` (instance transitions and timer management)

## Risks and Mitigations
- Risk: behavior regression in execution pipeline.
  - Mitigation: preserve public signatures and event output shapes; run `npx tsc --noEmit` and smoke API checks.
- Risk: transaction refactor can alter warning flow.
  - Mitigation: preserve warnings as local accumulators and return payload shape unchanged.
- Risk: reuse of idle emulators can expose stale state.
  - Mitigation: keep cleanup checks and stop-on-failure path.

## Validation Strategy
- Compile: `npx tsc --noEmit`
- Grep checks for removed brittle constructs/hardcoded values.
- Targeted runtime sanity checks for queue + MCP via code inspection and type checks.

