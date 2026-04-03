# Index Audit Baseline

Date: 2026-04-03  
Phase: 0 baseline draft  
Schema source: `apps/web/prisma/schema.prisma`

## 1. Purpose

Track index coverage for critical query paths and enforce index-safety checks for all expand/migrate/contract changes.

## 2. Current Index Inventory (Summary)

Primary high-traffic models and relevant indexes:

- `TestRun`
  - `@@index([testCaseId, createdAt(sort: Desc)])`
  - `@@index([status])`
  - `@@index([status, requiredCapability, createdAt(sort: Asc)])`
  - `@@index([assignedRunnerId, leaseExpiresAt])`
  - `@@index([requestedDeviceId])`
  - `@@index([requestedRunnerId])`
  - `@@index([deletedAt, completedAt(sort: Asc)])`
- `TestRunEvent`
  - `@@unique([runId, sequence])`
  - `@@index([runId, createdAt(sort: Asc)])`
  - `@@index([createdAt(sort: Desc)])`
- `Runner`
  - `@@index([teamId, kind])`
  - `@@index([teamId, status, lastSeenAt])`
- `RunnerDevice`
  - `@@unique([runnerId, deviceId])`
  - `@@index([runnerId, state, lastSeenAt])`
- `AndroidResourceLock`
  - `@@id([hostFingerprint, resourceKey])`
  - `@@index([runnerId, leaseExpiresAt])`
  - `@@index([leaseExpiresAt])`
- `UsageRecord`
  - `@@index([projectId, createdAt(sort: Desc)])`
  - `@@index([actorUserId, createdAt(sort: Desc)])`
  - `@@index([projectId, actorUserId, createdAt(sort: Desc)])`

## 3. Critical Query Coverage Baseline

| Query path | Predicates / sort | Current index coverage | Status |
|---|---|---|---|
| Queue claim candidate (`lib/runners/claim-service.ts`) | `status=QUEUED`, `deletedAt IS NULL`, `assignedRunnerId IS NULL`, `requiredCapability`, optional `requiredRunnerKind`, `createdAt ASC` | Partial (`status+requiredCapability+createdAt`, plus single-field indexes) | Watch |
| Queue lease ownership updates (`lib/runners/claim-service.ts`, `lib/runners/lease-reaper.ts`) | `assignedRunnerId`, `leaseExpiresAt`, `status`, `deletedAt` | Good for `assignedRunnerId+leaseExpiresAt`; partial for status/deleted filters | Watch |
| Run history listing (`api/test-cases/[id]/history`) | `testCaseId`, `createdAt DESC` | Covered by `testCaseId+createdAt DESC` | Pass |
| SSE/event stream reads (`api/test-runs/[id]/events`) | `runId`, sequence/created ordering | Covered by `runId+sequence` unique and `runId+createdAt` | Pass |
| Team runner inventory (`teams/*`, runner services) | `teamId`, `status`, `lastSeenAt` and `teamId`, `kind` | Covered | Pass |
| Runner device eligibility (`claim-service`) | `runnerId`, `state`, `lastSeenAt` | Covered | Pass |
| Usage aggregation (`teams/[id]/usage`) | `projectId` or `actorUserId` with created-at ranges | Covered by composite usage indexes | Pass |

Status meanings:
- `Pass`: index coverage aligns with current query shape.
- `Watch`: query shape is covered partially; monitor with explain/load-gate before schema changes.
- `Gap`: no adequate index; add in expand step before rollout.

## 4. Baseline Watch Items

1. `TestRun` queue claim path uses multiple optional filters (`requiredRunnerKind`, `requestedRunnerId`, `requestedDeviceId`) not fully represented in one composite index.
2. Soft-delete + completion scans (`deletedAt`, `completedAt`) should remain monitored as retention policy evolves.
3. Raw SQL in claim path should be re-checked with `EXPLAIN (ANALYZE, BUFFERS)` after any schema/index change touching `TestRun`.

## 5. Index-Safety Policy for Migrations

For every migration that touches indexed tables:

1. Record intended index diffs in this document before merge.
2. For changed critical queries, capture explain-plan output against seeded data.
3. No index drop in same release window as structure expansion/backfill unless equivalent replacement index exists and is validated.
4. Update load-gate baseline when query shape or cardinality changes.

## 6. Change Log Template

Append one entry per migration PR:

- Date:
- PR / commit:
- Tables affected:
- Indexes added:
- Indexes changed:
- Indexes removed:
- Explain-plan evidence location:
- Pre/post metric summary:
- Decision (`Pass` / `Rollback` / `Needs follow-up`):
