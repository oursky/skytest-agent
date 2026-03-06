---
name: runner-integration
description: Guide for implementing and reviewing hosted browser runners, macOS runners, durable job claiming, heartbeats, event ingestion, and Android capability routing. Use when changing runner lifecycle, run claiming, execution ownership, or hosted-vs-macOS execution behavior.
---

# Runner Integration

Use this skill when the task changes how work is claimed, executed, cancelled, or reported by runners.

## Trigger Conditions

Use this skill when touching:
- `src/lib/runners/`
- `src/runners/`
- `desktop/`
- run claim/heartbeat/complete/fail APIs
- run submission capability matching
- browser execution extraction
- Android execution routing

## Source Of Truth

Read:
- `docs/plans/2026-03-06-control-plane-macos-runner-design.md`
- `docs/plans/2026-03-06-control-plane-macos-runner-plan.md`

## Runner Model

There are only two runner classes this month:
- hosted browser runner
- macOS desktop runner

Capability rules:
- browser-only runs may use hosted browser runner
- Android runs must use macOS runner

## Required Behaviors

### Claiming

- runs are created durably in Postgres
- runners poll for claimable work
- claim happens transactionally
- one run can be claimed by one runner only
- claim writes runner id and lease expiry

### Heartbeat

- every active runner heartbeats on a short interval
- last-seen time must be persisted
- stale leases must be reaped or failed by control-plane logic

### Event and Artifact Flow

- runner sends event batches to control plane
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

The control plane should not:
- execute browser tests directly
- inspect local Android SDK/device state for run eligibility

### 3. Separate browser and Android codepaths

When editing execution code:
- move shared helpers into shared modules
- keep browser-specific logic separate
- keep Android-specific logic separate

Do not let Android-only dependencies leak into hosted browser runner flow.

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
