# Migration Risk Register (Initial Draft)

Date: 2026-04-03  
Phase: 0 baseline draft

## 1. Scope

This register tracks architecture and schema/data migration risks for:
- API/auth standardization
- runtime and worker decomposition
- runner-protocol contract hardening
- hotspot decomposition across web/cli/macos-runner

Use this register for every migration slice that changes data structures, contracts, or critical-path behavior.

## 2. Risk Rating Scale

- Likelihood: `L` (low), `M` (medium), `H` (high)
- Impact: `L` (low), `M` (medium), `H` (high)
- Score: `likelihood x impact`

## 3. Risk Register

| ID | Area | Phase | Risk | Likelihood | Impact | Primary controls | Rollback/fallback trigger | Evidence required before close |
|---|---|---|---|---|---|---|---|---|
| MR-001 | API Auth | 2a | Route loses auth/ownership checks during dedup refactor | M | H | deny-by-default route check, shared guard helper, route tests | Any route auth-check missing in CI or manual review | CI auth coverage report + route test pass |
| MR-002 | API Contract | 2a-3b | Response shape drift breaks UI/CLI callers | M | H | typed result interfaces, compatibility assertions for touched endpoints | client parsing error or contract test failure | contract tests + touched UI flow smoke |
| MR-003 | Runtime Queue | 2b-3a | Claim/dispatch semantics regress causing stuck/duplicate jobs | M | H | parity tests for claim/dispatch/cancel/events, worker idempotency checks | duplicate claims or stalled queue detected in staging/local load gate | runtime parity suite + load-gate comparison |
| MR-004 | Worker Loop | 3c | Restart mid-cycle causes duplicate processing or dropped work | M | H | explicit lease/heartbeat overlap prevention, restart simulation tests | duplicate-processing or dropped-work assertion fails | crash-recovery test evidence |
| MR-005 | SSE Path | 2a-3b | SSE endpoint throughput/backpressure degrades under load | M | M | SSE load-gate baseline and threshold checks | error-rate or latency threshold breach | SSE load report pre/post |
| MR-006 | Runner Protocol | 2a-3c | DTO/event contract drift across web/cli/macos-runner | M | H | ban subpath imports, protocol audit, shared contract tests | protocol test mismatch or runtime deserialization failure | protocol compatibility report |
| MR-007 | MCP Manifest | 3a | Tool manifest change introduces breaking behavior | M | H | snapshot gate for names/input/response contract | snapshot diff without versioning decision | manifest snapshot test result |
| MR-008 | DB Schema | any migration slice | expand/migrate/contract executed in unsafe order | L | H | mandatory migration runbook markers, release sequencing rule | destructive drop appears in same release as expand/migrate | migration checklist + PR markers |
| MR-009 | DB Integrity | any migration slice | backfill job leaves inconsistent rows | M | H | idempotent backfill job, postcondition assertion script | assertion mismatch on seeded/staging data | assertion query output |
| MR-010 | DB Performance | any migration slice | index regression increases query latency on critical paths | M | M | index audit update, explain-plan sanity checks, load comparison | latency regression beyond agreed threshold | index audit update + metric diff |
| MR-011 | Frontend Orchestration | 3b | page decomposition causes behavior regression in run/project views | M | M | feature-level orchestration hooks, view-model tests, targeted smoke checks | user flow failures in run/project pages | UI regression checklist |
| MR-012 | Merge Coordination | all | overlapping hotspot changes cause high-conflict and hidden regressions | H | M | one-concern-per-PR policy, sequencing by boundary foundations | repeated conflict churn or reverted fixes | PR sequencing log |

## 4. Mandatory Migration Checklist (per change)

1. `Expand` step documented with backward-compatible schema additions.
2. `Migrate` step documented with idempotent backfill strategy.
3. `Contract` step separated into later release window.
4. Rollback/fallback steps documented before merge.
5. Index-safety impact reviewed and logged in `plans/index-audit.md`.
6. Data-integrity assertions defined and executed on seeded DB checks.

## 5. Ownership Template

For each migration PR, append:
- Owner:
- Reviewer:
- Migration class (contract/schema/runtime/API):
- Affected systems:
- Pre-merge evidence links:
- Rollback command/path:
- Post-deploy validation checks:

## 6. Review Cadence

- Update this register during Phase 0-2 planning and before every migration PR merge.
- Re-score risks after each phase exit checkpoint.
- Keep closed risks in history; do not delete entries, mark them `Closed` with evidence date.
