# Android Runtime Deployment Checklist

Audience: operators enabling Android testing in a shared or self-hosted deployment.

Use this checklist before exposing Android execution to users.

## Hosting Model

- [ ] Run web control plane and runner agents as separate processes
- [ ] Run the control plane from `infra/helm`
- [ ] Size control-plane pods for browser execution, because browser runs execute inside those pods
- [ ] Keep Postgres available to control plane (required for claims/leases/events)
- [ ] Keep S3-compatible object storage available to control plane for artifacts and uploaded files
- [ ] Run at least one `MACOS_AGENT` runner for Android execution capacity
- [ ] Run runner maintenance on a singleton worker or cron schedule

References:

- [Android runtime maintenance](../maintainers/android-runtime-maintenance.md)
- [macOS Android runner guide](./macos-android-runner-guide.md)
- [Infrastructure and Kubernetes deployment](../../infra/README.md)

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

- [ ] Understand Android jobs are claimed by connected runner agents, not by control-plane pods
- [ ] Understand Android device resources are host-scoped leased keys and can be in use by one active run at a time:
  - connected devices: `connected-device:<serial>`
  - emulator profiles: `emulator-profile:<profileName>`
- [ ] Understand `Clear App Data` only affects the target app package (not full emulator wipe)
- [ ] Understand other device state can persist across runs
- [ ] Understand manual app installation is required; no auto-install flow is provided

## Observability / Operations

- [ ] Monitor control-plane health endpoints and rollout status after each deploy
- [ ] Monitor control plane logs for claim, lease-expiry, and runner auth errors
- [ ] Monitor runner logs for emulator boot failures and connected-device failures
- [ ] Monitor run pickup latency and runner heartbeat freshness
- [ ] Periodically verify installed emulator profiles still match expected names in projects/test cases

## Incident Response Basics

- [ ] If Android runs stall, check runner heartbeat and runner device sync freshness
- [ ] If runner host is unhealthy, restart the runner process and republish inventory
- [ ] If selected devices disappear mid-run, revalidate availability from `Team Settings -> Runners`
