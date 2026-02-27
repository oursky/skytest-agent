# Android Runtime Maintenance Notes

Audience: maintainers / coding agents changing Android runtime behavior.

This document describes the current Android device runtime behavior and operational constraints for this app.

Related docs:

- [`docs/maintainers/coding-agent-maintenance-guide.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/coding-agent-maintenance-guide.md)
- [`docs/operators/android-runtime-deployment-checklist.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/android-runtime-deployment-checklist.md)
- [`docs/operators/mac-android-emulator-guide.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/mac-android-emulator-guide.md)

## Runtime Capability Gating (Important)

- Android support is now gated by two conditions:
  - per-user feature flag (`androidEnabled`)
  - server runtime capability (Android tooling available on the host)
- Effective Android availability is `androidEnabled && androidRuntimeAvailable`.
- Non-Android servers are supported: the app should still boot and serve browser-only features.
- Android UI/API surfaces should be hidden or rejected when the server runtime is not Android-capable (do not rely on the user flag alone).

## Deployment Model (Important)

- `src/lib/queue.ts`, `src/lib/android-device-manager.ts`, and `src/lib/emulator-pool.ts` are in-process singletons.
- Queue state, device ownership, and emulator wait queues live only in memory.
- This runtime is currently intended for a single long-lived app process.

Implications:

- Do not run multiple app replicas against the same host Android device/ADB environment without adding centralized coordination/locking.
- Serverless/ephemeral runtimes are not compatible with the current emulator pool design.
- Process restart will clear queue/pool state and active runs are marked failed on startup.

## Managed Runtime Devices vs Host Inventory

- Managed runtime devices are those tracked by `androidDeviceManager`:
  - emulator instances started/tracked via `emulatorPool`
  - connected physical devices currently attached as reusable leases
- Host inventory is discovered from ADB + local profiles:
  - connected devices (`adb devices -l`)
  - emulator profiles (AVDs) available on the host
- Unmanaged connected emulators are host emulators visible to ADB but not currently tracked by the app runtime (for example, Android Studio/manual launches).

Security behavior:

- `/api/devices` requires auth + Android access (`androidEnabled && androidRuntimeAvailable`).
- `/api/devices` returns:
  - runtime device status for the current host/process (used by the project device panel)
  - host inventory (`connectedDevices`, `emulatorProfiles`) for device selection/UI display
- Ownership checks are enforced for project-scoped actions and run metadata, but inventory visibility is intentionally host-level. Treat host access as privileged.
- `/api/devices` stop action:
  - allows stopping managed emulators
  - allows stopping connected emulators by serial (ADB `emu kill`) when not managed
  - rejects stopping connected physical devices

## Reuse and Isolation Model

- Emulator-profile reuse is project-scoped (`projectId` + emulator profile/AVD name).
- Connected physical devices are leased by serial and reused in-process when healthy.
- After a run, Android targets are released through `androidDeviceManager` (not always fully shut down).
- Cleanup is best-effort and includes:
  - returning to home
  - `am kill-all`
  - optional app-specific `am force-stop` + `pm clear` (depends on target toggle)

What persists across runs by design:

- Emulator disk state outside the explicitly targeted app package
- Physical-device state outside the explicitly targeted app package
- Other installed apps and their data
- System settings and general device state changes that cleanup does not revert

If stronger isolation is required in the future:

- dedicated emulator per run, or
- dedicated physical device per tenant/project, or
- full wipe/cold-boot policy, or
- tenant-isolated emulator hosts/containers

## Clear App Data Toggle Semantics

- `clearAppData: true`:
  - app data is cleared before launch
  - app data is also cleared during release cleanup
- `clearAppData: false`:
  - app data is not cleared before launch
  - app data is not cleared during release cleanup

This preserves app state across runs when the emulator is reused.

For connected physical devices, the same app-specific cleanup toggle semantics apply.

## Queueing and Capacity Behavior

- Emulator-profile acquisition:
  - if no matching idle emulator is available and pool capacity is available, the pool boots a new emulator
  - if capacity is full, requests wait in an in-memory wait queue until:
    - a matching emulator is released, or
    - capacity is freed and a replacement boot is triggered, or
    - the acquire timeout is reached
- Connected-device acquisition:
  - targets a specific serial
  - fails if the device is missing, unauthorized/offline, or already acquired
  - reuses an in-process lease if healthy, otherwise recreates the lease/attachment

Capacity-freeing events that now wake waiters:

- manual stop
- idle timeout stop
- health-check failure stop
- force reclaim stop
- cleanup failure stop fallback

## Stop Lifecycle Notes

- Stop requests attempt `adb emu kill` and process termination.
- The pool now waits for process exit (bounded timeout) before freeing ports and marking the emulator dead.
- If the process does not exit after `SIGTERM`, a `SIGKILL` attempt is made before final cleanup.
- Connected physical devices are not stopped by app APIs; only emulator stop flows perform process termination.

## Copy Log Behavior

- The "Copy Log" action copies the raw run report and events without backend redaction.
- `masked` variables are only masked in frontend config displays.
