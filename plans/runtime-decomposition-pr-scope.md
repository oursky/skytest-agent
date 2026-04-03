# Runtime Decomposition PR Scope (First Slice)

Date: 2026-04-03  
Task: Immediate action 14

## 1. Objective

Create the first safe seam extraction from `apps/web/src/lib/runtime/test-runner.ts` without changing run semantics.

## 2. Target Slice

Primary file:
- `apps/web/src/lib/runtime/test-runner.ts`

First seam to extract:
- runner event emission + state transition helpers into focused modules under `apps/web/src/lib/runtime/`.

Proposed new modules (initial):
- `apps/web/src/lib/runtime/run-status.ts`
- `apps/web/src/lib/runtime/run-event-emitter.ts`
- `apps/web/src/lib/runtime/run-result-normalizer.ts`

## 3. Scope Rules

In scope:
- pure/helper extraction only
- import rewiring inside runtime module
- parity tests updates where needed

Out of scope:
- queueing policy changes
- lease policy changes
- external API contract changes
- macOS runner behavior changes

## 4. Execution Plan

1. Identify pure functions and side-effect-heavy blocks in `test-runner.ts`.
2. Extract pure transitions first (status/result mapping).
3. Extract event payload shaping into dedicated helper.
4. Keep side-effect orchestration in `test-runner.ts` for this slice.
5. Ensure each extraction has equivalent tests or focused regression assertions.

## 5. Acceptance Criteria

1. Existing runtime behavior remains identical for queue/dispatch/cancel/event paths.
2. `test-runner.ts` net complexity is reduced (fewer responsibilities).
3. No contract drift in produced run events.
4. `npm run verify` passes.

## 6. Validation Matrix

- targeted runtime unit tests for extracted modules
- integration checks for run execution happy path + failure path
- event ordering and status transition regression checks

## 7. Risk Controls

- keep extraction boundaries small and reviewable
- no semantic edits mixed with extraction moves
- if parity fails, revert extraction chunk and re-slice smaller

## 8. Follow-up Slices

After first seam extraction:
1. isolate artifact persistence concerns
2. isolate usage accounting concerns
3. isolate test-case config resolution concerns
