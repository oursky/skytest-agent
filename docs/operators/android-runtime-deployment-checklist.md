# Android Runtime Deployment Checklist

Audience: operators / self-hosters who run SkyTest with Android testing enabled.

Use this checklist before enabling Android testing on a host or environment.

If you are running a server without Android SDK/emulator tooling, skip this checklist. SkyTest basic features remain available, while Android UI/API paths are hidden or rejected by server capability gating.

## Hosting Model

- [ ] Run the app as a single long-lived process for Android runtime usage
- [ ] Do not run multiple replicas against the same local emulator/ADB environment
- [ ] Do not deploy Android runtime on serverless/ephemeral instances

Reference:

- `docs/maintainers/android-runtime-maintenance.md` (deployment model and singleton constraints)
- `docs/operators/mac-android-emulator-guide.md` (host setup + troubleshooting)

## Host Prerequisites

- [ ] Android SDK installed and available to the app process
- [ ] `adb` and `emulator` binaries resolvable from configured SDK path
- [ ] Required emulator templates (AVDs, shown as "Emulators" in UI) are created on the host
- [ ] Host has sufficient CPU/RAM for configured emulator pool size

## Security / Multi-Tenant Safety

- [ ] Confirm `/api/emulators` is only used by authenticated users with Android enabled and Android-capable server runtime
- [ ] Confirm users only see pool-managed emulators for their own projects
- [ ] Confirm users cannot stop unmanaged host emulators through user APIs
- [ ] Treat the host as sensitive: local ADB/emulator access should be restricted to trusted operators

## Runtime Behavior Expectations

- [ ] Understand emulator reuse is project-scoped, not run-scoped
- [ ] Understand `Clear App Data` only affects the target app package (not full emulator wipe)
- [ ] Understand other emulator/device state can persist across runs
- [ ] Set queue/emulator capacity with expected concurrency and boot time in mind

## Observability / Operations

- [ ] Monitor app logs for emulator boot failures, cleanup failures, and health-check stops
- [ ] Monitor queue wait times and cancellation rates
- [ ] Periodically verify installed emulator templates still match expected names in projects/test cases

## Incident Response Basics

- [ ] If Android runs stall, check `adb devices` and host emulator processes
- [ ] If pool behavior becomes inconsistent after host issues, restart the app process (stale active runs will be marked failed on startup)
- [ ] If emulator templates change, revalidate test case Android entry points against current runtime inventory
