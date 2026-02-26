# Android Runtime Deployment Checklist

Audience: operators / self-hosters who run this app with Android testing enabled.

Use this checklist before enabling Android testing on a host or environment.

If you are running a server without Android SDK/emulator tooling, skip this checklist. Basic features remain available, while Android UI/API paths are hidden or rejected by server capability gating.

## Hosting Model

- [ ] Run the app as a single long-lived process for Android runtime usage
- [ ] Do not run multiple replicas against the same local Android device/ADB environment
- [ ] Do not deploy Android runtime on serverless/ephemeral instances

Reference:

- [`docs/maintainers/android-runtime-maintenance.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/android-runtime-maintenance.md) (deployment model and singleton constraints)
- [`docs/operators/mac-android-emulator-guide.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/mac-android-emulator-guide.md) (host setup + troubleshooting)

## Host Prerequisites

- [ ] Android SDK installed and available to the app process
- [ ] `adb` and `emulator` binaries resolvable from configured SDK path
- [ ] Required emulator profiles (AVDs, shown under Devices -> Emulators in UI) are created on the host
- [ ] If using physical Android devices, USB debugging is enabled and devices can be listed by `adb devices`
- [ ] Host has sufficient CPU/RAM for configured emulator pool size

## Security / Multi-Tenant Safety

- [ ] Confirm `/api/devices` is only used by authenticated users with Android enabled and Android-capable server runtime
- [ ] Confirm managed runtime device ownership is scoped to the user's projects
- [ ] Confirm connected device inventory visibility matches your trust model for the host
- [ ] Confirm users cannot stop connected physical devices through user APIs
- [ ] Treat the host as sensitive: local ADB/emulator access should be restricted to trusted operators

## Runtime Behavior Expectations

- [ ] Understand emulator profile reuse is project-scoped, not run-scoped
- [ ] Understand connected physical devices are leased by serial and can be in use by only one run at a time
- [ ] Understand `Clear App Data` only affects the target app package (not full emulator wipe)
- [ ] Understand other device state can persist across runs
- [ ] Set queue/emulator capacity with expected concurrency and boot time in mind

## Observability / Operations

- [ ] Monitor app logs for emulator boot failures, cleanup failures, and health-check stops
- [ ] Monitor app logs for connected-device attach/health failures (if physical devices are used)
- [ ] Monitor queue wait times and cancellation rates
- [ ] Periodically verify installed emulator profiles still match expected names in projects/test cases

## Incident Response Basics

- [ ] If Android runs stall, check `adb devices` and host emulator processes
- [ ] If pool behavior becomes inconsistent after host issues, restart the app process (stale active runs will be marked failed on startup)
- [ ] If emulator profiles or connected devices change, revalidate test case Android targets against current runtime inventory
