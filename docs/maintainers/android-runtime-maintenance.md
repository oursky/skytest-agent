# Android Runtime Maintenance Notes

Audience: maintainers / coding agents changing Android runtime behavior.

This document describes the current Android emulator runtime behavior and operational constraints for this app.

Related docs:

- `docs/maintainers/coding-agent-maintenance-guide.md`
- `docs/operators/android-runtime-deployment-checklist.md`
- `docs/operators/mac-android-emulator-guide.md`

## Runtime Capability Gating (Important)

- Android support is now gated by two conditions:
  - per-user feature flag (`androidEnabled`)
  - server runtime capability (Android tooling available on the host)
- Effective Android availability is `androidEnabled && androidRuntimeAvailable`.
- Non-Android servers are supported: the app should still boot and serve browser-only features.
- Android UI/API surfaces should be hidden or rejected when the server runtime is not Android-capable (do not rely on the user flag alone).

## Deployment Model (Important)

- `src/lib/queue.ts` and `src/lib/emulator-pool.ts` are in-process singletons.
- Queue state, emulator ownership, and emulator wait queues live only in memory.
- This runtime is currently intended for a single long-lived app process.

Implications:

- Do not run multiple app replicas against the same host emulator environment without adding centralized coordination/locking.
- Serverless/ephemeral runtimes are not compatible with the current emulator pool design.
- Process restart will clear queue/pool state and active runs are marked failed on startup.

## Managed vs Unmanaged Emulators

- Managed emulators are those started and tracked by `emulatorPool`.
- Unmanaged emulators are any host emulators visible to `adb` but not tracked by the app (for example, Android Studio/manual launches).

Security behavior:

- `/api/emulators` now returns only pool-managed emulators owned by the current user’s projects.
- `/api/emulators` stop action only allows stopping owned managed emulators.
- The app does not expose or control unmanaged host emulators through the user API.

## Reuse and Isolation Model

- Emulator reuse is project-scoped (`projectId` + emulator template name).
- After a run, Android targets are released back to the pool (not always fully shut down).
- Cleanup is best-effort and includes:
  - returning to home
  - `am kill-all`
  - optional app-specific `am force-stop` + `pm clear` (depends on target toggle)

What persists across runs by design:

- Emulator disk state outside the explicitly targeted app package
- Other installed apps and their data
- System settings and general device state changes that cleanup does not revert

If stronger isolation is required in the future:

- dedicated emulator per run, or
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

## Queueing and Capacity Behavior

- If no matching idle emulator is available and pool capacity is available, the pool boots a new emulator.
- If capacity is full, requests wait in an in-memory wait queue until:
  - a matching emulator is released, or
  - capacity is freed and a replacement boot is triggered, or
  - the acquire timeout is reached

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

## Copy Log Secret Masking

- The "Copy Log" action masks secret values.
- Secret values are fetched lazily on copy (not preloaded in page state anymore).
- Masking uses current project/test case secret values at copy time.

Known limitation:

- If secret values were rotated after the run, older secret values that appear in historical logs may not be masked.
- Fully solving this requires masking at event-write time (or another server-side historical redaction strategy).
