# Phase 3 Control Plane + macOS Runner Implementation Plan

**Goal:** Execute the next product phase from the current team/Authgear baseline by adding durable runner infrastructure, hosted browser execution, and macOS Android execution without creating a second full desktop product.

**Context:**

- Phase 2 is already centered on `Team`, `TeamMembership`, `Project`, Authgear sync, email-first pending memberships, and team-level OpenRouter key ownership.
- Invite flows and organization hierarchy are not part of the target architecture.
- The next milestone is runtime architecture, not another membership rewrite.
- Backward compatibility with the old local queue and API-owned execution model is not required.

## Design Rules

- The web app remains the primary product surface.
- A macOS deliverable may exist only as a runner agent or thin diagnostics shell.
- Delete stale runtime paths once the replacement path is working.
- Do not add organizations, invites, or other superseded abstractions back into scope.

## Current Baseline Checklist

These are already true and should be treated as prerequisites, not new work:

- Authgear-backed users sync into local `User` rows by `authId`.
- Team membership can be created by email and auto-claimed on login/signup.
- Roles are `OWNER`, `ADMIN`, `MEMBER`.
- Team AI key management exists.
- Team settings, membership management, and ownership transfer flows exist in the web UI.

## Phase 3A: Durable Queue And Runner Schema

### Task 3A.1: Add runner models and auth
**Files:** `prisma/schema.prisma`, `src/types/index.ts`, `src/types/database.ts`, `src/lib/security/api-key.ts` or new runner auth helper, `src/app/api/runners/register/route.ts`, `src/app/api/runners/heartbeat/route.ts`
**Steps:**
1. Add `Runner` plus hashed runner-token storage.
2. Model runner type and capability payloads explicitly.
3. Add registration and heartbeat endpoints.
4. Keep the auth format simple and runner-friendly.
**Validation:** register a fake runner and confirm heartbeat updates status.

### Task 3A.2: Make run ownership durable
**Files:** `prisma/schema.prisma`, `src/app/api/run-test/route.ts`, `src/types/index.ts`
**Steps:**
1. Add `requestedByUserId`, `assignedRunnerId`, `requiredCapabilitiesJson`, and `leaseExpiresAt` to `TestRun`.
2. Derive required capabilities at run creation time.
3. Stop treating local process memory as run ownership.
**Validation:** create browser and Android runs and confirm DB rows are self-contained.

### Task 3A.3: Add append-only run events
**Files:** `prisma/schema.prisma`, `src/app/api/runners/jobs/[id]/events/route.ts`, `src/app/api/test-runs/[id]/events/route.ts`
**Steps:**
1. Add a durable `TestRunEvent` model.
2. Ingest runner event batches into the database.
3. Update SSE readers to poll durable events.
**Validation:** events remain visible after an API restart.

### Task 3A.4: Build claim and lease recovery services
**Files:** `src/lib/runners/claim-service.ts`, `src/lib/runners/lease-reaper.ts`, `src/app/api/runners/jobs/claim/route.ts`, `src/app/api/runners/jobs/[id]/complete/route.ts`, `src/app/api/runners/jobs/[id]/fail/route.ts`
**Steps:**
1. Claim one compatible queued run inside a transaction.
2. Set and renew leases through heartbeat/claim logic.
3. Requeue or fail expired leases with visible logging.
**Validation:** double-claim is prevented and stale leases are recovered.

## Phase 3B: Extract Hosted Browser Execution

### Task 3B.1: Split execution code by platform
**Files:** `src/lib/runtime/test-runner.ts`, `src/lib/execution/browser/*`, `src/lib/execution/android/*`, `src/lib/execution/shared/*`
**Steps:**
1. Separate browser and Android execution code from the monolithic runner.
2. Keep behavior unchanged while moving files.
3. Leave a thin orchestration layer only as a temporary bridge.
**Validation:** lint passes and one local browser smoke run still works.

### Task 3B.2: Add browser runner process
**Files:** `src/runners/browser-runner.ts`, `src/lib/runners/client.ts`, `package.json`
**Steps:**
1. Create the polling loop for hosted browser execution.
2. Register browser capabilities.
3. Claim jobs, emit events, and report completion/failure.
**Validation:** `npm run runner:browser` completes a browser-only run end to end.

### Task 3B.3: Remove direct API-owned execution
**Files:** `src/app/api/run-test/route.ts`, `src/instrumentation.ts`, `src/lib/runtime/queue.ts`, `src/lib/runtime/test-runner.ts`
**Steps:**
1. Make the API create durable runs only.
2. Move browser execution ownership fully into the browser runner process.
3. Remove obsolete queue helpers once callers are migrated.
**Validation:** API restart no longer interrupts ownership of an in-flight browser run.

## Phase 3C: Build The macOS Runner

### Task 3C.1: Create macOS runner workspace
**Files:** `desktop/package.json`, `desktop/runner/index.ts`, `desktop/README.md`
**Steps:**
1. Create an isolated macOS runner workspace.
2. Keep the first deliverable focused on the runner process, not a product shell.
3. Load control-plane URL and runner token from config.
**Validation:** runner can start locally and attempt registration.

### Task 3C.2: Add Android capability detection
**Files:** `src/lib/android/*`, `desktop/runner/index.ts`
**Steps:**
1. Reuse Android detection logic where it is still valid.
2. Report device/emulator capabilities from the runner, not the API host.
3. Surface meaningful diagnostics for missing SDK/device state.
**Validation:** macOS runner reports `browser-only` or `android-ready` accurately.

### Task 3C.3: Execute Android jobs through the macOS runner
**Files:** `desktop/runner/index.ts`, `src/lib/execution/android/*`, runner client files
**Steps:**
1. Claim only Android-compatible jobs.
2. Run Android execution locally.
3. Upload durable events, artifacts, and final result.
4. Respect cancellation and lease expiry.
**Validation:** one Android run completes through the runner without API-local execution.

### Task 3C.4: Add minimal packaging and diagnostics
**Files:** `desktop/package.json`, optional thin shell files if needed, `docs/operators/mac-android-emulator-guide.md`
**Steps:**
1. Add a packaging command for internal distribution.
2. If a UI is required, keep it minimal: status, logs, config, reconnect.
3. Do not build a second full navigation shell.
**Validation:** packaged internal build can connect to the control plane.

## Phase 3D: Web UX For Runner Availability

### Task 3D.1: Add runner availability APIs
**Files:** `src/app/api/teams/[id]/runners/route.ts`, `src/lib/runners/availability-service.ts`
**Steps:**
1. Return runner inventory relevant to a team.
2. Include capability summaries and last heartbeat.
3. Keep the response focused on run-form and settings needs.
**Validation:** web UI can distinguish browser availability from Android availability.

### Task 3D.2: Update run submission UX
**Files:** `src/app/run/page.tsx`, `src/components/features/configurations/*`, `src/i18n/messages.ts`
**Steps:**
1. Show runner availability based on current test target requirements.
2. Explain when Android execution is unavailable because no macOS runner is online.
3. Keep browser-only runs usable in hosted mode.
**Validation:** browser runs stay enabled when Android is unavailable; Android state is clearly explained.

### Task 3D.3: Add team-level runner visibility
**Files:** `src/app/teams/page.tsx`, new runner settings component if needed, `src/i18n/messages.ts`
**Steps:**
1. Add a runner status surface under team settings or a dedicated team runners view.
2. Show online/offline, type, version, and Android readiness.
3. Add setup instructions for connecting a macOS runner.
**Validation:** a team owner/admin can see the connected runner state without leaving the web app.

## Phase 3E: MCP And Runtime Cleanup

### Task 3E.1: Remove local runtime assumptions from MCP
**Files:** `src/app/api/mcp/route.ts`, `src/lib/mcp/server.ts`, `src/lib/runners/*`
**Steps:**
1. Replace local Android inventory reads with runner inventory data.
2. Keep MCP control-plane only.
3. Preserve permission checks through team/project access helpers.
**Validation:** MCP can reason about capability availability without local host assumptions.

### Task 3E.2: Remove remaining dead paths
**Files:** `src/lib/runtime/queue.ts`, `src/lib/runtime/project-events.ts`, `src/app/api/projects/[id]/events/route.ts`, any stale docs
**Steps:**
1. Search for queue, local-event, and host-capability assumptions.
2. Delete dead code instead of leaving compatibility wrappers behind.
3. Update docs/operators only after the runtime path is real.
**Validation:** `rg` shows no obsolete invite/org/runtime leftovers for the new architecture.

## Verification

Run before phase completion and before merging major slices:

- `npm run verify`
- targeted runner tests for claim/lease/event flows
- one browser-run smoke test through the hosted runner
- one Android-run smoke test through the macOS runner

## Phase 3 Exit Criteria

- The web app is still the only primary product UI.
- Browser execution no longer runs inside the API process.
- Android execution no longer depends on the API host machine.
- Runner claims, heartbeats, leases, and events are durable.
- The web UI communicates runner availability clearly.
- No organization or invite abstractions were reintroduced.
