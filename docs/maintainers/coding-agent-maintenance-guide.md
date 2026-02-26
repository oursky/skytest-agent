# Coding Agent Maintenance Guide

This guide is for developers and coding agents making changes in this repository.

It complements `AGENTS.md` with project-specific runtime invariants that are easy to break when changing Android support, queueing, and run lifecycle logic.

## Read These First (For Android Runtime Changes)

- `AGENTS.md` (repo workflow, constraints, style)
- [`docs/maintainers/android-runtime-maintenance.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/android-runtime-maintenance.md) (runtime behavior + hosting constraints)
- [`docs/operators/android-runtime-deployment-checklist.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/android-runtime-deployment-checklist.md) (operator expectations you should not accidentally invalidate)

## High-Risk Runtime Areas

### 1. Test Queue (`src/lib/queue.ts`)

Responsibilities:

- enqueue / dequeue runs
- in-process concurrency control
- run status transitions (`QUEUED`, `PREPARING`, `RUNNING`, terminal states)
- event buffering + incremental log persistence
- cancellation handling

Key invariants:

- queue advancement must not depend on unguarded async calls
- cancellation should not be overwritten by late job completion
- cleanup may be triggered from both queue cancellation and test-runner teardown, so cleanup paths must be idempotent

### 2. Test Runner (`src/lib/test-runner.ts`)

Responsibilities:

- resolve runtime targets (browser + Android)
- setup browsers/emulators
- execute steps
- capture screenshots/logs
- cleanup targets

Key invariants:

- Android device handles should be released through `androidDeviceManager.release(...)` (not always force-stopped)
- Android `clearAppData` semantics must remain consistent between pre-launch and release cleanup
- cleanup must remain safe if called more than once

### 3. Android Device Manager (`src/lib/android-device-manager.ts`)

Responsibilities:

- unify Android runtime acquisition/release across emulator profiles and connected physical devices
- expose device pool status for `/api/devices`
- enforce connected-device lease exclusivity by serial
- delegate emulator lifecycle to `EmulatorPool`

Key invariants:

- connected physical devices must never be force-stopped by app APIs
- emulator and physical-device cleanup paths must remain idempotent
- status visibility/ownership fields used by `/api/devices` must stay consistent with auth checks

### 4. Emulator Pool (`src/lib/emulator-pool.ts`)

Responsibilities:

- manage emulator lifecycle (boot, acquire, release, stop)
- enforce pool capacity
- wait queue for emulator acquisition
- health checks / idle shutdown

Key invariants:

- any capacity-freeing stop path should wake waiters
- stop lifecycle should wait for process exit before freeing ports
- pool state is in-memory and process-local (single-process runtime assumption)

## Hosted Runtime Constraints (Do Not “Accidentally Scale”)

- `TestQueue` and `EmulatorPool` are process-local singletons.
- `AndroidDeviceManager` is also a process-local singleton (and wraps `EmulatorPool`).
- Android runtime is not safe for multi-replica/serverless deployments without redesign.
- Avoid adding behavior that assumes cross-process visibility of in-memory queue/emulator state.

If you add features that expose Android device state or control:

- preserve ownership checks
- be explicit about managed runtime status vs host inventory visibility
- avoid adding privileged control of connected physical devices

## Documentation Update Checklist for Code Changes

When changing Android runtime behavior, update docs in the same PR/commit series:

- Operator-facing impact:
  - [`docs/operators/mac-android-emulator-guide.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/mac-android-emulator-guide.md)
  - [`docs/operators/android-runtime-deployment-checklist.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/android-runtime-deployment-checklist.md)
- Maintainer-facing impact:
  - [`docs/maintainers/android-runtime-maintenance.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/android-runtime-maintenance.md)
- Import/export behavior:
  - [`docs/maintainers/test-case-excel-format.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/test-case-excel-format.md)

## Common Footguns

- Changing Excel import parser compatibility paths without updating `docs/maintainers/test-case-excel-format.md`
- Bypassing `androidDeviceManager.release(...)` in normal Android run teardown
- Adding unguarded fire-and-forget promises in queue processing
- Overwriting `CANCELLED` status after the job finishes late
- Changing operator-visible device behavior without updating setup/runbook docs
