# Android Runtime Maintenance Notes

Audience: maintainers / coding agents changing Android runtime behavior.

This document describes the Phase 3 Android runner behavior and operational constraints.

Related docs:

- [`docs/maintainers/coding-agent-maintenance-guide.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/coding-agent-maintenance-guide.md)
- [`docs/operators/android-runtime-deployment-checklist.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/android-runtime-deployment-checklist.md)
- [`docs/operators/mac-android-emulator-guide.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/mac-android-emulator-guide.md)

## Runtime Capability Gating (Important)

- Android support is runner-driven, not API-host-driven.
- Web control plane can run without Android SDK or ADB tooling.
- Android functionality appears when at least one `MACOS_AGENT` runner is connected and publishing devices.

## Deployment Model (Important)

- Control plane and runner agents are separate processes.
- Control plane responsibilities:
  - durable run scheduling/state in Postgres
  - runner auth/claim/event APIs
  - team-scoped runner/device inventory aggregation from runner inventory
- Runner responsibilities:
  - local Android discovery
  - Android execution
  - event/artifact/result publishing

Implications:

- Restarting control plane should not drop run ownership (leases are durable).
- Restarting a runner drops local execution capacity until it reconnects and republishes inventory.
- Multiple runners can coexist; claim/lease ownership is resolved in DB.

## Device Inventory Model

- Runner publishes snapshots to `/api/runners/v1/devices/sync`.
- Target product model exposes aggregated team-scoped inventory in `Team Settings -> Runners`.
- Device freshness and availability are derived from runner heartbeat and device `lastSeenAt`.
- The old `/api/devices` host-local route is removed.

Security behavior:

- Runner APIs require bearer runner token auth and per-token rate limits.
- All runner write-back endpoints enforce run ownership through `assignedRunnerId` + active lease.
- Stream tokens remain resource-scoped; run token for run A cannot read run B.

## Manual App Installation Rule

- Runner must not auto-install, update, or remove Android apps.
- Devices must be manually prepared by operators before runs.
- Execution may clear app state if configured, but not mutate installation lifecycle.

## Clear App Data Toggle Semantics

- `clearAppData: true`:
  - app data is cleared before launch
  - app data is also cleared during release cleanup
- `clearAppData: false`:
  - app data is not cleared before launch
  - app data is not cleared during release cleanup

This preserves app state across runs when the emulator is reused.

For connected physical devices, the same app-specific cleanup toggle semantics apply.

## Scheduling and Capacity Behavior

- Control plane stores runs as `QUEUED` and runners claim with long-poll.
- Explicit-device runs can be claimed only by the runner that currently owns/publishes that device.
- Lease expiry recovery and event retention run in `src/workers/runner-maintenance.ts`.

## Copy Log Behavior

- The "Copy Log" action copies the raw run report and events without backend redaction.
- `masked` variables are only masked in frontend config displays.
