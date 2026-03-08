---
name: runner-integration
description: Guide for implementing and reviewing control-plane browser execution, macOS CLI runners, durable job claiming, heartbeats, event ingestion, and Android capability routing. Use when changing runner lifecycle, run claiming, execution ownership, or browser-vs-Android execution behavior.
---

# Runner Integration

Use this skill when the task changes how work is claimed, executed, cancelled, or reported by runners.

## Trigger Conditions

Use this skill when touching:
- `src/lib/runners/`
- `cli-runner/`
- `src/lib/runtime/local-browser-runner.ts`
- `src/lib/runtime/test-runner.ts`
- run claim/heartbeat/complete/fail APIs
- run submission capability matching
- browser execution behavior
- Android execution routing

## Source Of Truth

Read:
- `docs/maintainers/android-runtime-maintenance.md`
- `docs/maintainers/coding-agent-maintenance-guide.md`
- `docs/operators/android-runtime-deployment-checklist.md`

## Runner Model

Execution model:
- browser runs execute in the control plane process
- Android runs execute in macOS `cli-runner`

Capability rules:
- browser-only runs do not require a runner claim
- Android runs must be claimed by a compatible macOS runner

## Required Behaviors

### Claiming

- runs are created durably in Postgres
- macOS runners poll for claimable Android work
- claim happens transactionally
- one run can be claimed by one runner only
- claim writes runner id and lease expiry

### Heartbeat

- every active runner heartbeats on a short interval
- last-seen time must be persisted
- stale leases must be reaped or failed by control-plane logic

### Event and Artifact Flow

- runner and control-plane browser execution both write event batches through the same control-plane ingestion services
- control plane persists them
- UI reads persisted state
- screenshots and files go to object storage

### Cancellation

- cancellation must be durable and visible to the runner
- runner should acknowledge cancellation when possible
- do not depend on in-memory cancellation state as the source of truth

## Workflow

### 1. Start with capability routing

For every run-related change, ask:
- what capabilities does the run require?
- which runner types may claim it?
- what should happen if no compatible runner is online?

### 2. Keep the API process free of execution logic

The control plane should:
- create runs
- schedule runs
- persist state
- execute browser runs

The control plane should not:
- inspect local Android SDK/device state for run eligibility

### 3. Separate browser and Android codepaths

When editing execution code:
- move shared helpers into shared modules
- keep browser-specific logic separate
- keep Android-specific logic separate

Do not let Android-only dependencies leak into control-plane browser execution flow.

### 4. Prefer service and API tests over brittle full-stack tests

Add deterministic coverage for:
- claim exclusivity
- lease expiry
- cancellation state
- capability matching
- event ingestion ordering

## Guardrails

- no new in-memory queue ownership
- no project event fanout via process-local listeners
- no direct Android host checks in the web control plane for capability truth
- no hosted Android execution path

## Completion Checklist

- compatible runner can claim the correct job type
- incompatible runner cannot claim it
- active run survives control-plane restarts
- events are visible through persisted state
- `npm run lint` passes
- targeted runner tests pass
