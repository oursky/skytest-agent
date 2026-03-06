# Phase 3 Control Plane + macOS Runner Design

**Goal:** Prepare the next delivery phase after team/Authgear foundation by making test execution durable, hosted-browser capable, and Android-capable through a macOS runner without creating a second full product surface.

**Decision Date:** 2026-03-06
**Primary Constraint:** Move fast without carrying dead compatibility or multiplying apps that must stay visually and behaviorally in sync.

## 1. Current Product Baseline

Phase 2 already changed the product model materially. The active baseline is now:

- Authgear is the identity source of truth.
- Local users sync by `User.authId`, with email reconciliation from Authgear userinfo when needed.
- A `Team` is the shared workspace boundary.
- A `Project` belongs to a `Team`.
- Team membership is email-first:
  - exact-email matches auto-claim when the user logs in or signs up
  - unclaimed rows remain as pending memberships
  - there is no invite token flow
- Roles are `OWNER`, `ADMIN`, and `MEMBER`.
- Team-level OpenRouter key management lives on `Team`.
- Usage is attributed to the actor user and grouped under the team/project model.

Anything that still talks about organizations, project invites, or user-level OpenRouter ownership is stale and should be removed rather than adapted.

## 2. Product Shape Decision

### Decision

Do **not** maintain both:

- a full web product
- and a full macOS product that mirrors the web UI

Maintain **one product UI**: the web control plane.

If we need a macOS deliverable, it should be a **runner agent** with at most a thin setup and diagnostics shell. It is operational tooling, not a second primary app.

### Why

Maintaining both a web app and a mac app as first-class surfaces is the wrong tradeoff right now:

- Every product flow must be designed, tested, and released twice.
- Auth, navigation, settings, and permissions drift quickly between shells.
- Desktop-only UI bugs add cost without adding product differentiation.
- The real platform-specific requirement is Android execution access on macOS, not a second UI.

The web app already owns:

- Authgear login
- team/project management
- API key management
- usage reporting
- member and ownership administration
- project CRUD and test authoring

That should stay true in Phase 3.

## 3. Phase 3 Outcome

At the end of Phase 3:

- the web app remains the only primary control plane and product UI
- browser runs execute through hosted runner processes, not inside the API process
- Android runs execute only through a connected macOS runner
- run ownership, heartbeats, claims, events, and completion are durable in Postgres
- the web UI can show runner availability, device inventory, and explain why Android execution is blocked when no macOS runner is online
- MCP depends on control-plane state and runner inventory APIs, not local process state

## 4. Scope

### In Scope

- Durable runner registration, authentication, heartbeat, and claiming.
- Durable run ownership and lease recovery.
- Hosted browser runner extraction from the API process.
- macOS runner agent for Android execution.
- Web UI updates for runner availability, device inventory, and setup guidance.
- Removal of remaining local-only runtime assumptions from the control plane.

### Explicitly Out Of Scope

- Organization hierarchy.
- Invite tokens, invite status, resend invite flows, or any other invitation model.
- A desktop app that embeds the full hosted web UI.
- Native Swift product UI.
- Long-lived backward-compatibility layers for local queue ownership.
- New role types beyond `OWNER`, `ADMIN`, `MEMBER`.

## 5. Target Architecture

### Web Control Plane

Keep the current Next.js app as the single control plane for:

- Authgear authentication
- team, membership, project, and ownership APIs
- test case and project CRUD
- team AI key management
- usage reporting
- run creation
- runner registration and job assignment APIs
- runner event and artifact ingestion
- MCP
- browser-facing SSE/status APIs

### Hosted Browser Runner

Run browser execution in a separate worker process or deployment.

Responsibilities:

- register itself as browser-capable
- poll for compatible queued runs
- execute browser jobs
- stream durable events back to the control plane
- upload artifacts and final results

### macOS Runner

The macOS deliverable is a runner first.

Preferred form:

- background runner process with packaging for macOS distribution
- optional small diagnostics shell or tray UI only if needed for setup, logs, and status

Not the goal:

- a second full app shell around the hosted web product

Responsibilities:

- discover Android SDK, devices, and emulators
- register capabilities with the control plane
- publish connected-device and available-emulator inventory
- claim Android-compatible jobs
- execute Android runs locally
- upload events, screenshots, logs, and results

### Manual App Install Rule

Manual app installation is a product requirement, not a temporary limitation.

That means:

- the runner does not install APKs or app bundles
- the control plane does not manage app distribution
- the device flow should make it clear that users prepare the device state themselves before running tests
- the runner may verify app presence or device readiness, but it must not mutate installed app state as part of job setup

## 6. Data Model Direction

### Existing Core Models To Keep

- `User`
- `Team`
- `TeamMembership`
- `Project`
- `TestCase`
- `TestRun`
- `UsageRecord`

### New Models And Fields For Phase 3

Add durable runner entities:

- `Runner`
  - `id`
  - `teamId` or globally scoped visibility if we later decide hosted runners are shared
  - `type` (`HOSTED_BROWSER`, `MACOS`)
  - `status`
  - `version`
  - `capabilitiesJson`
  - `lastHeartbeatAt`
  - `lastSeenIp` if useful operationally
- `RunnerToken` or hashed token fields attached to `Runner`
- `TestRunEvent`
  - append-only event rows with monotonic ordering
- `TestRun` additions
  - `requestedByUserId`
  - `assignedRunnerId`
  - `requiredCapabilitiesJson`
  - `leaseExpiresAt`
  - `lastEventAt`
  - runner lifecycle timestamps as needed

### Capability Model

Capabilities should be explicit and boring:

- `browserSupported`
- `androidConnectedSupported`
- `androidEmulatorSupported`
- `platform`
- `maxConcurrentRuns`
- `labels`
- `version`

Do not derive product behavior from the API host machine anymore.

## 7. Runner Protocol

Use HTTPS polling over simple JSON APIs.

Required endpoints:

- `POST /api/runners/register`
- `POST /api/runners/heartbeat`
- `POST /api/runners/jobs/claim`
- `POST /api/runners/jobs/:id/events`
- `POST /api/runners/jobs/:id/artifacts`
- `POST /api/runners/jobs/:id/complete`
- `POST /api/runners/jobs/:id/fail`
- `POST /api/runners/jobs/:id/cancel-ack`

### Queue Ownership

Do not use the in-memory queue as the source of truth.

Queue semantics should be:

- API creates a durable `TestRun` in `QUEUED`
- runner claims a compatible run inside a transaction
- claim sets `assignedRunnerId`, `leaseExpiresAt`, and in-progress status
- expired leases are reaped and requeued or failed by policy

### Event Delivery

Do not rely on in-memory process event maps.

Use append-only durable run events and poll them for SSE delivery.

## 8. UI Changes For Phase 3

The web app should explain runner state instead of hiding it.

### Run UI

- Browser runs can be submitted when a hosted browser runner exists.
- Android runs remain queued or are blocked with a clear explanation when no macOS runner is available.
- For Android runs, the user should be able to select from currently available devices exposed by connected runners.
- Device selection should prefer explicit runner-reported devices over generic capability-only scheduling when the user has chosen a specific target.
- The page should surface the missing capability, not a generic error.

### Project Devices UI

Device operations belong in the existing `Project > Devices` tab in the web control plane.

The `Devices` tab should let the user:

- see all currently available devices and emulators relevant to the project
- inspect runner source, online/offline state, and last heartbeat
- understand whether a device is available for test runs
- perform device-related functions that do not conflict with the manual-install rule
- access setup guidance for connecting a macOS runner

The minimum useful device data is:

- device name
- device identifier
- runner name or runner type
- online/offline state
- platform version if available
- emulator vs physical device
- availability for scheduling

### Team UI

Team settings should still show high-level runner setup and status, but device-level operations should live on the project page, not the team settings page.

## 9. MCP Rule

MCP remains control-plane only.

That means:

- no dependency on local API-process Android inventory
- no dependency on in-memory queue ownership
- capability-aware behavior must read from runner inventory and team/project data

## 10. Removal Rules

When Phase 3 work starts, delete these assumptions instead of preserving them:

- direct browser execution inside the API request path
- API-process ownership of queued runs
- API-process Android capability as product capability
- stale docs and code paths that assume invite tokens or organization hierarchy

Temporary adapters are allowed only if they are short-lived and have an explicit same-branch removal step.

## 11. Acceptance Criteria

Phase 3 is done when:

- the web app is still the only primary UI surface
- no run depends on API pod memory for ownership
- browser runs complete through a hosted runner process
- Android runs complete only through a macOS runner
- runner events survive process restart
- team members can understand runner and device availability from the web UI
- the existing `Project > Devices` tab is the canonical UI for device visibility and selection
- no new organization or invite abstractions were introduced
