# Runner Protocol Contract Audit

Date: 2026-04-03  
Scope: `apps/web`, `apps/cli`, `apps/macos-runner`, `packages/runner-protocol`

## 1. Executive Summary

Audit result: `CONDITIONAL PASS`

- Consumer imports found: `27`
  - `apps/web`: `22`
  - `apps/cli`: `3`
  - `apps/macos-runner`: `2`
- Boundary violations found: `2` direct subpath imports
  - `apps/cli/src/runtime/runner-manager.ts`
  - `apps/macos-runner/runner/engine.ts`

Primary contract risk is package-boundary leakage (`@skytest/runner-protocol/src/*`) rather than DTO/schema divergence.

## 2. Package Contract Surface

Current package:
- Name: `@skytest/runner-protocol`
- Version: `0.1.0`
- Main/types entry: `src/index.ts`
- Additional module used by consumers: `src/host-fingerprint.ts`

Observation:
- package now has a strict root-only `exports` map (`"." -> ./src/index.ts`), mechanically enforcing the contract boundary.

## 3. Consumer Coverage Matrix

| Consumer | Usage type | Status |
|---|---|---|
| `apps/web/src/app/api/runners/v1/**` | request/response schema parsing + protocol metadata | pass |
| `apps/web/src/lib/runners/*` | shared protocol types (`RunnerEventInput`, `RunnerCapability`, etc.) | pass |
| `apps/cli/src/runtime/control-plane.ts` | protocol schemas and response parsing | pass |
| `apps/cli/src/state/types.ts` | protocol transport metadata type | pass |
| `apps/macos-runner/runner/engine.ts` | protocol schemas/types for runner-control-plane exchange | pass |
| `apps/cli/src/runtime/runner-manager.ts` | host fingerprint helper via subpath | boundary violation |
| `apps/macos-runner/runner/engine.ts` | host fingerprint helper via subpath | boundary violation |

## 4. Findings

### F-001 (High): Direct subpath imports bypass contract boundary

Evidence:
- `apps/cli/src/runtime/runner-manager.ts` imports `@skytest/runner-protocol/src/host-fingerprint`
- `apps/macos-runner/runner/engine.ts` imports `@skytest/runner-protocol/src/host-fingerprint`

Risk:
- internal file moves in protocol package can break consumers without versioned contract signal

Required fix:
- expose `resolveHostFingerprint` from package root export and remove subpath imports

### F-002 (Resolved): Public contract was not mechanically enforced

Evidence:
- `packages/runner-protocol/package.json` now defines a strict `exports` field for root-only access.

Risk (before fix):
- future subpath usage could be reintroduced silently

Resolution:
- strict `exports` map added
- existing CI boundary check retained to deny subpath imports in consumers

### F-003 (Low): Version defaults are duplicated in consumers

Evidence:
- CLI and macOS runner both set local fallback `runnerVersion` values (`0.1.0`)

Risk:
- drift risk if minimum/current version policy changes without synchronized updates

Recommended fix:
- centralize fallback derivation from protocol constants where feasible

## 5. DTO Drift Check

Current result: no critical DTO drift detected in audited runner transport flows.

Evidence signals:
- runner API routes and CLI control-plane client import protocol request/response schemas from package root and parse payloads through those schemas.
- runner transport metadata is typed through shared protocol types.

## 6. Required Actions Before Deep Decomposition

1. Remove all `@skytest/runner-protocol/src/*` imports.  
2. Enforce root-only contract imports in CI.  
3. ✅ Add package `exports` boundary once compatibility validated for local workspace tooling.

## 7. Audit Decision

Decision: `APPROVED WITH ACTIONS`

Gate to Phase 2b/3 decomposition should require F-001 completion and automated enforcement against recurrence.
