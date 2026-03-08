# Android Runtime Deployment Checklist

Audience: operators / self-hosters who run this app with Android testing enabled.

Use this checklist before enabling Android testing in a runner-enabled environment.

## Hosting Model

- [ ] Run web control plane and runner agents as separate processes
- [ ] Run browser execution workers as separate processes from the control plane
- [ ] Keep Postgres available to control plane (required for claims/leases/events)
- [ ] Run at least one `MACOS_AGENT` runner for Android execution capacity
- [ ] Run runner maintenance on a singleton worker or cron schedule

Reference:

- [`docs/maintainers/android-runtime-maintenance.md`](https://github.com/oursky/skytest-agent/blob/main/docs/maintainers/android-runtime-maintenance.md) (runner architecture constraints)
- [`docs/operators/mac-android-emulator-guide.md`](https://github.com/oursky/skytest-agent/blob/main/docs/operators/mac-android-emulator-guide.md) (host setup + troubleshooting)

## Runner Host Prerequisites

- [ ] Android SDK installed and available to the runner process
- [ ] `adb` and `emulator` binaries resolvable on runner host
- [ ] Required emulator profiles (AVDs) are created on the host and match names used in test targets
- [ ] If using physical Android devices, USB debugging is enabled and devices can be listed by `adb devices`
- [ ] Host has sufficient CPU/RAM for configured emulator pool size
- [ ] Runner can reach control plane URL over HTTPS

## Security / Multi-Tenant Safety

- [ ] Confirm runner pairing tokens are issued only by team members
- [ ] Confirm runner tokens are rotated/revoked according to your policy
- [ ] Confirm team device visibility is exposed through `Team Settings -> Runners`
- [ ] Confirm stream-token auth remains resource-scoped for run events
- [ ] Treat the host as sensitive: local ADB/emulator access should be restricted to trusted operators

## Runtime Behavior Expectations

- [ ] Understand Android jobs are claimed by connected runner agents, not API servers
- [ ] Understand connected physical devices are leased by serial and can be in use by one active run at a time
- [ ] Understand `Clear App Data` only affects the target app package (not full emulator wipe)
- [ ] Understand other device state can persist across runs
- [ ] Understand manual app installation is required; no auto-install flow is provided

## Observability / Operations

- [ ] Monitor control plane logs for claim, lease-expiry, and runner auth errors
- [ ] Monitor runner logs for emulator boot failures and connected-device failures
- [ ] Monitor run pickup latency and runner heartbeat freshness
- [ ] Periodically verify installed emulator profiles still match expected names in projects/test cases

## Incident Response Basics

- [ ] If Android runs stall, check runner heartbeat and runner device sync freshness
- [ ] If runner host is unhealthy, restart the runner process and republish inventory
- [ ] If selected devices disappear mid-run, revalidate availability from `Team Settings -> Runners`
