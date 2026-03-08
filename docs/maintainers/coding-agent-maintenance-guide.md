# Coding Agent Maintenance Guide

This guide is for developers and coding agents making changes in this repository.

It complements `AGENTS.md` with project-specific runtime invariants for the current runner architecture.

## Read These First

- `AGENTS.md` (repo workflow, constraints, style)
- [`docs/maintainers/android-runtime-maintenance.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/android-runtime-maintenance.md) (runner runtime behavior + constraints)
- [`docs/operators/android-runtime-deployment-checklist.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/android-runtime-deployment-checklist.md) (operator rollout expectations)

## High-Risk Runtime Areas

### 1. Runner Orchestration (`src/lib/runners/*`, `src/app/api/runners/v1/*`)

Responsibilities:

- runner auth and token lifecycle
- claim/lease ownership for queued runs
- runner heartbeat/device sync
- ordered event ingestion and terminal run transitions
- retention and lease maintenance (`src/workers/runner-maintenance.ts`)

Key invariants:

- claim must be atomic and prevent double-claim
- write-back endpoints must enforce assigned runner + active lease ownership
- stream token scope checks must remain strict per run/resource
- maintenance tasks should stay out of Next.js request lifecycle

### 2. Runner Client (`cli-runner/runner/index.ts`)

Responsibilities:

- register/heartbeat with control plane
- publish device inventory
- claim Android jobs and execute tests
- push events/artifacts/final status

Key invariants:

- protocol version fields must be sent on every runner request
- runner token rotation/expiry behavior must not be bypassed
- runners must not mutate app installation state automatically

### 3. Execution Engine (`src/lib/runtime/test-runner.ts`)

Responsibilities:

- shared browser/Android execution logic used by runner clients
- step execution, event generation, and cleanup behavior

Key invariants:

- cleanup must stay idempotent when cancellation races run completion
- Android device handles must be released via `androidDeviceManager.release(...)`
- `clearAppState` and permission behavior must remain stable

## Control Plane Constraints

- Browser execution is worker-owned (`src/workers/browser-runner.ts`) and run state persists in Postgres leases.
- Android execution stays runner-owned and must not move into web request handlers.
- Team-facing device visibility must come from runner-published inventory, not host-local inspection.
- Do not re-introduce project-scoped device inventory surfaces; active UI is `Team Settings -> Runners`.
- Do not re-introduce host-local Android inventory assumptions into web APIs.

If you add features that expose Android state/control:

- preserve ownership checks
- keep behavior team/project-scoped through runner ownership
- avoid privileged host-level actions from web routes

## Documentation Update Checklist for Code Changes

When changing runner runtime behavior, update docs in the same PR/commit series:

- Operator-facing impact:
  - [`docs/operators/mac-android-emulator-guide.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/mac-android-emulator-guide.md)
  - [`docs/operators/android-runtime-deployment-checklist.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/android-runtime-deployment-checklist.md)
- Maintainer-facing impact:
  - [`docs/maintainers/android-runtime-maintenance.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/android-runtime-maintenance.md)
- Import/export behavior:
  - [`docs/maintainers/test-case-excel-format.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/test-case-excel-format.md)

## Common Footguns

- Changing Excel import parser compatibility paths without updating `docs/maintainers/test-case-excel-format.md`
- Breaking runner protocol request/response shapes without updating `packages/runner-protocol`
- Bypassing lease ownership checks on runner write-back endpoints
- Re-introducing in-memory control-plane execution ownership
- Changing operator-visible runner/device behavior without updating setup/runbook docs
