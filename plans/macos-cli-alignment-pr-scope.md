# macOS Runner and CLI Alignment PR Scope (First Slice)

Date: 2026-04-03  
Task: Immediate action 15

## 1. Objective

Prepare the first alignment slice between `apps/macos-runner` and `apps/cli` after protocol boundary cleanup.

## 2. Preconditions

1. direct `@skytest/runner-protocol/src/*` imports removed (completed)
2. runner protocol contract audit completed (completed)

## 3. First Alignment Slice

Focus area:
- runner identity/credential lifecycle alignment

In-scope modules:
- `apps/cli/src/runtime/runner-manager.ts`
- `apps/cli/src/runtime/control-plane.ts`
- `apps/macos-runner/runner/engine.ts`
- `apps/macos-runner/runner/credential-store.ts`

## 4. Planned Outcomes

1. align runner credential refresh semantics between CLI and macOS runner
2. align host fingerprint derivation and fallback behavior
3. align runner shutdown/unpair/repair flow error handling semantics
4. document shared invariants for token expiry and rotation handling

## 5. Non-Goals

- no changes to queue scheduling policies
- no changes to web API transport contracts
- no changes to database schema

## 6. Technical Plan

1. Define shared lifecycle invariants in a focused doc block at PR top.
2. Extract CLI-side repeated credential-handling branches into smaller helpers.
3. Mirror equivalent helper boundaries in macOS runner engine where practical.
4. Ensure both clients parse/handle control-plane errors consistently.

## 7. Validation Plan

- CLI runner flows:
  - pair
  - start
  - stop
  - unpair
- macOS runner flows:
  - pairing exchange
  - heartbeat
  - claim loop
  - credential verify/rotation
  - shutdown
- `npm run verify`

## 8. Acceptance Criteria

1. no protocol contract drift between CLI and macOS runner
2. identical expected behavior for credential-expiry and revoked-token paths
3. reduced duplicated lifecycle branching in touched modules
4. clear rollback path (single PR revert without schema impact)

## 9. Rollback Trigger

Rollback immediately if any of the following occur:
- runner fails to recover from credential rotation
- pairing exchange success rate regresses
- CLI local runner state transitions become inconsistent with actual process state
