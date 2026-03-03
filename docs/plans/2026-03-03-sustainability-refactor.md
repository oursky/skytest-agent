# Sustainability Refactor Implementation Plan

**Goal:** Deliver a maintainability-focused refactor with reliability/security fixes and modularization of high-complexity files.
**Context:** Keep behavior stable, preserve singleton patterns, avoid broad unrelated refactors, and validate with TypeScript.

### Task 1: Queue cancellation robustness
**Files:** `src/lib/queue.ts`
**Steps:**
- Update cancellation flow so running job state is always cleared even if cleanup callback fails.
- Ensure cancellation still records terminal status and schedules next job.
- Keep existing status/event semantics.
**Validation:** `npx tsc --noEmit`; verify running-state cleanup paths compile.

### Task 2: MCP atomic DB mutations
**Files:** `src/lib/mcp-server.ts` (+ helper modules under `src/lib/mcp/` if extracted)
**Steps:**
- Wrap create/update test case operations and config mutations in `prisma.$transaction`.
- Keep current response payload (warnings, counts, fields).
- Preserve ownership/auth checks.
**Validation:** `npx tsc --noEmit`; verify no type regressions in handlers.

### Task 3: Safe JSON parsing for test case fields
**Files:** `src/lib/test-case-utils.ts`
**Steps:**
- Add safe JSON parse utility with typed fallback for `steps` and `browserConfig`.
- Avoid uncaught exceptions from malformed stored JSON.
**Validation:** `npx tsc --noEmit`.

### Task 4: Android package ID validation
**Files:** `src/lib/test-runner.ts` (or extracted android helper module)
**Steps:**
- Add `validateAndroidPackageName` helper.
- Enforce validation before shell commands that interpolate package IDs.
- Return configuration error with clear message on invalid package IDs.
**Validation:** `npx tsc --noEmit`.

### Task 5: Replace brittle Playwright statement splitting
**Files:** `src/lib/test-runner.ts` (or `src/lib/test-runner/playwright-sandbox.ts`)
**Steps:**
- Remove heuristic splitting and execute one sandboxed async block per step.
- Retain timeout handling, timer cleanup, safe-page wrapper, blocked token checks.
- Preserve step-level logs and screenshot behavior.
**Validation:** `npx tsc --noEmit`.

### Task 6: Emulator pool reuse behavior
**Files:** `src/lib/emulator-pool.ts`
**Steps:**
- Reuse matching healthy idle emulator on acquire.
- After successful release cleanup, transition back to `IDLE` and schedule timers.
- Keep stop-on-failure and explicit stop semantics.
**Validation:** `npx tsc --noEmit`.

### Task 7: Config-driven timing constants
**Files:** `src/config/app.ts`, `src/lib/queue.ts`, `src/lib/test-runner.ts`
**Steps:**
- Introduce config entries for currently hardcoded timings.
- Replace literals with config references.
- Keep effective defaults equivalent to current behavior.
**Validation:** `npx tsc --noEmit`.

### Task 8: Modularize longest lib scripts
**Files:**
- `src/lib/test-runner.ts` -> `src/lib/test-runner/*`
- `src/lib/mcp-server.ts` -> `src/lib/mcp/*`
- `src/lib/queue.ts` -> `src/lib/queue/*`
- `src/lib/emulator-pool.ts` -> `src/lib/emulator-pool/*` (as needed)
**Steps:**
- Extract cohesive helper modules with minimal behavioral changes.
- Keep public entry points stable (`runTest`, `createMcpServer`, `queue`, `emulatorPool`).
- Limit each extraction to one concern per module.
**Validation:** `npx tsc --noEmit` after each extraction chunk.

### Task 9: Highest-impact non-lib long-file seams
**Files:**
- `src/utils/testCaseExcel.ts`
- `src/components/ConfigurationsSection.tsx`
- `src/app/run/page.tsx`
**Steps:**
- Extract pure utility helpers into adjacent modules where low-risk.
- Reduce file complexity without changing UI behavior.
**Validation:** `npx tsc --noEmit`.

### Task 10: Final verification and summary
**Files:** (all touched)
**Steps:**
- Run full TypeScript compile check.
- Produce a concise change summary and residual risk list.
**Validation:** `npx tsc --noEmit`.

