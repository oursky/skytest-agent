# Team Runners and Kubernetes Model

Audience: maintainers / coding agents changing runner architecture, team settings UX, or Android device visibility.

This document defines the target product and deployment model for runner-backed execution.

It is the direction to implement. Where current code still uses project-scoped device visibility, treat that as legacy and remove it rather than extending it.

## Goals

- Keep browser execution infrastructure-managed and largely invisible to normal users.
- Move Android device inventory and runner management to `Team Settings -> Runners`.
- Remove `Project > Devices` as a standalone product surface.
- Keep browser workers compatible with Kubernetes deployment.
- Keep macOS Android execution on external Mac hosts.
- Preserve the manual Android app installation rule.

## Non-Goals

- No desktop/browser auto-install of Android apps.
- No attempt to run macOS Android runners inside Kubernetes.
- No backward-compatible coexistence of both project-level and team-level device surfaces.
- No migration layer that keeps legacy project device routes, tabs, or wording alive.

## Deployment Topology

The intended runtime split is:

- `web` deployment in Kubernetes
  - Next.js UI
  - authenticated API routes
  - MCP HTTP endpoint
  - durable run creation and result presentation
- `browser-runner` deployment in Kubernetes
  - stateless worker pods
  - claims browser runs from Postgres-backed queue
  - launches browsers per claimed run and tears them down after execution
- `runner-maintenance` worker in Kubernetes
  - lease expiry recovery
  - old event retention cleanup
- `postgres`
  - durable queue, leases, runner metadata, events
- `s3` / `minio`
  - screenshots, uploads, artifacts
- `macOS runners` outside Kubernetes
  - team-owned external agents on Mac hardware
  - publish Android device inventory
  - execute Android runs on connected devices/emulators

## Product Model

### Browser execution

- Browser execution is platform-managed capacity.
- Normal users should not create, pair, or configure browser runners.
- Browsers start and stop automatically per run.
- Browser worker capacity is a team-scoped backend concern, not a project-level UI concern.

UI implication:

- Do not expose raw browser runner bootstrap/token flows to normal users.
- Team admins may see browser execution health/capacity in `Team Settings -> Runners`, but not low-level provisioning details in normal use.

### Android execution

- Android execution depends on one or more connected macOS runners for the team.
- Android devices are team resources, not project resources.
- Device inventory is published by macOS runners and displayed in `Team Settings -> Runners`.
- Projects and test runs consume team device inventory when selecting a target device.

UI implication:

- Remove `Project > Devices`.
- Add a `Runners` tab in Team Settings.
- Put runner status, pairing actions, and Android device inventory in that tab.

## Scope and Ownership

- Runners belong to a team.
- Browser worker capacity is shared by all projects and users in that team.
- Android devices published by a macOS runner are shared by all projects and users in that team.
- A run may only be claimed by a runner in the same team.
- An explicit Android device run may only be claimed by the runner currently publishing that device.

This preserves multi-project sharing without leaking capacity or devices across teams.

## Target UX

### Team Settings -> Runners

This tab becomes the single execution management surface for team admins.

Sections:

- `Execution`
  - browser execution status/capacity
  - overall queue health
- `Mac Runners`
  - runner label
  - status
  - last seen
  - runner version
  - device count
  - add / revoke / reconnect actions
- `Android Devices`
  - device name
  - serial / profile identifier
  - published by runner
  - online / stale / offline state
  - last seen
  - availability

Role behavior:

- Owner/Admin:
  - can pair or revoke macOS runners
  - can view device inventory and runner status
- Member:
  - may view team runner/device status if product wants visibility
  - must not manage pairing/revocation

### Run flow

- User creates or runs a test case from project surfaces as usual.
- If the run is browser-only, the system routes it to browser worker capacity automatically.
- If the run requires Android, the user selects from team-level available devices.
- If no Android capacity exists, show a team-level guidance state:
  - no macOS runner connected
  - macOS runner connected but no devices available
  - selected device became unavailable

### Pairing UX

The final product UX should not require `curl`.

Target admin flow:

1. Open `Team Settings -> Runners`
2. Click `Add Mac Runner`
3. Server creates a short-lived pairing token behind the UI
4. UI presents a one-time code, QR code, or deep link
5. macOS runner app exchanges the pairing token and stores runner credential

Current API token + `curl` bootstrap is an operator/developer fallback only.

## Target API Shape

Keep runner protocol routes under `/api/runners/v1/*` for runner-to-control-plane traffic.

Shift user-facing inventory and management routes to team scope:

- `GET /api/teams/:id/runners`
  - team runner list and browser execution status
- `GET /api/teams/:id/devices`
  - team Android device inventory derived from runner-published devices
- `POST /api/teams/:id/runner-pairing`
  - admin-only pairing token creation
- optional follow-up admin routes:
  - revoke runner credential
  - rename runner label
  - mark runner removed

Delete legacy user-facing project device routes:

- `/api/projects/:id/devices`

## Scheduling Rules

- Browser jobs remain queue-backed and are claimed by browser workers.
- Browser workers should run as stateless pods in Kubernetes.
- Android jobs remain queue-backed and are claimed by external macOS runners.
- Device-specific Android runs must continue to verify ownership atomically through the publishing runner.
- Team scoping remains mandatory in claim logic.

## Required Cleanup

Do not maintain both models.

This cutover is replacement-only:

- no compatibility window
- no legacy route aliases
- no duplicate UI tabs
- no hidden fallback hooks
- no migration-only code paths
- delete empty folders left behind by the removal

Delete or replace the following legacy surfaces:

- project-level device API:
  - `src/app/api/projects/[id]/devices/route.ts`
- project-level Android setup/device panel:
  - `src/components/features/device-status/ui/DeviceStatusPanel.tsx`
  - `src/components/features/device-status/ui/AndroidSetup.tsx`
  - `src/components/features/device-status/index.ts`
- project page Android tab usage:
  - `src/app/projects/[id]/page.tsx`
- project-scoped device fetch hook:
  - `src/components/features/configurations/hooks/useAndroidDeviceOptions.ts`
- i18n copy that assumes "for this project":
  - `src/i18n/messages.ts`

Replace with team-scoped equivalents under the team settings and run configuration flows.

## Implementation Slices

### Slice 1: Team-scoped device inventory API

- Add `GET /api/teams/:id/devices`
- Move availability aggregation logic off project-facing route naming
- Update run validation to reference team inventory wording/messages

### Slice 2: Team Settings Runners tab

- Extend `src/app/teams/page.tsx` with a `runners` tab
- Build team-scoped runner/device UI components
- Restrict pairing and revoke actions to owner/admin

### Slice 3: Run form device selection

- Update Android device option loading to read team-scoped inventory
- Keep selection UX inside run/test-case flows
- Remove dependency on a project devices page/tab

### Slice 4: Remove project device surface

- Delete project devices route and project page Android tab
- Remove unused device-status components and i18n strings
- Update operator and maintainer docs

### Slice 5: Kubernetes browser worker packaging

- Package browser runner as deployment-friendly worker process
- Separate browser worker operational docs from macOS runner docs
- Keep macOS runner as external host software, not a Kubernetes workload

## Validation Checklist

- Browser-only runs succeed without any user-visible runner setup steps.
- Team admins can pair a macOS runner from UI-backed flow.
- Android device inventory appears only in `Team Settings -> Runners`.
- No `Project > Devices` tab or route remains.
- Android run selection uses team-level devices and rejects stale/unavailable devices cleanly.
- Browser worker pool can scale horizontally in Kubernetes without cross-team leakage.
