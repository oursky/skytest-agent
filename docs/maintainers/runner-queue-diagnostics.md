# Runner Queue Diagnostics

This project now includes structured diagnostics to troubleshoot runs stuck in `QUEUED`.

## Claim lifecycle logs

- Endpoint: `POST /api/runners/v1/jobs/claim`
- Success log includes:
  - `runnerId`, `teamId`, `runId`
  - `requestedDeviceId`, `requiredCapability`
  - `leaseExpiresAt`, `elapsedMs`, `claimAttempts`
- Empty-claim log includes:
  - `reasonCode`
  - `claimAttempts`
  - queue counters (`queuedAndroidRuns`, `queuedCompatibleKindRuns`, `explicitRequestedRuns`, `genericQueuedRuns`)
  - host-lock counters (`explicitRequestedRunsBlockedByHostLocks`, `blockedHostResourceKeys`)
  - `claimableDeviceIds`

Use these logs to quickly identify whether the issue is:
- no queued work,
- capability/kind mismatch,
- requested device mismatch,
- or lock contention.

## Run diagnostics endpoint

- Endpoint: `GET /api/debug/test-runs/:id/diagnostics`
- Access: authenticated project members only.

Response includes:
- run assignment/lease state,
- team runner snapshots (`status`, `capabilities`, `isFresh`, claimable device IDs),
- published runner devices,
- run claimability analysis (`reasonCode`, `eligibleRunnerIds`, `matchingRequestedDeviceRunnerIds`, `requestedResourceKey`, `activeResourceLocks`),
- per-runner no-claim diagnostics from claim service.

This endpoint is intended for operator debugging and support workflows.

## Team runner inventory endpoint

- Endpoint: `GET /api/teams/:id/runner-inventory`
- Access: authenticated team members only.
- Returns:
  - team runner overview (`runners`, `runnerConnected`, `macRunnerOnlineCount`)
  - team device availability snapshot (`devices`, `availableDeviceCount`, `staleDeviceCount`)
  - management capability flag (`canManageRunners`)

This endpoint consolidates runner and device polling into a single request for the team runners UI.

## Lifecycle logs

Additional logs were added at key transitions:
- run creation (`POST /api/test-runs/dispatch`)
- local browser execution start (`POST /api/test-runs/dispatch`)
- run completion/failure by runner (`apps/web/src/lib/runners/event-service.ts`)
- run cancellation (`POST /api/test-runs/:id/cancel`)

## Diagnosing unexpected CANCELLED runs

When a run settles `CANCELLED` unexpectedly — most often a member of a run session or Test
Group that should have run (or should have been attributed to a different cause) — **read the
persisted cancellation reason before reading orchestration code.** Each cancel path writes a
distinct reason string, so the reason alone tells you which branch fired.

- Canonical reasons: `CANCELLATION_REASON` in `apps/web/src/lib/runtime/cancellation-reasons.ts`
  (`USER_SINGLE`, `USER_GROUP`, `MCP`, `MCP_FOR_UPDATE`, `LOGIN_FLOW_FAILED`, `EARLIER_CASE_FAILED`).
- The run's `error` holds the reason string; `cancellationReasonCodeFor(status, error)` maps it
  back to the machine-readable code. Read it via `mcp__skytest__get_run_session` /
  `get_test_run`, the diagnostics endpoint, or a direct `TestRun` lookup.

Playbook for any "wrong terminal state" bug:

1. Fetch the actual record (session rollup + each member's `status` and `error`) — do not
   theorize from code first.
2. Grep the reason string to its single emission site — it jumps straight to the guilty branch.
   All group cancel sites live in `executeGroupSession` (`run-session-orchestrator.ts`).
3. Ask what made that branch's condition true and trace backward. Example: `USER_GROUP` on a
   run nobody stopped means `controller.signal.aborted` was true — i.e. a session-wide abort,
   not a per-case failure. (`EARLIER_CASE_FAILED` would instead mean the STOP failure-mode
   branch fired.)

Reason-to-cause quick map:
- `EARLIER_CASE_FAILED` — Test Group in STOP mode skipped the rest after a case failed.
- `LOGIN_FLOW_FAILED` — a group login prefix failed and STOP halted its dependents.
- `USER_GROUP` / `USER_SINGLE` — the shared session `AbortController` was aborted (genuine user
  stop, or a bug propagating a per-member abort to the session — session members are isolated
  via `createMemberAbortController` precisely to prevent the latter).

## AI Provider Config Propagation

For paired runners, AI provider/model settings are resolved from team configuration when job details are loaded (`POST /api/runners/v1/jobs/:id/details`), not from runner-local defaults.

Payload fields returned in job details config:
- `aiProvider`
- `midsceneModelOptions`

If Team Settings model changes are not reflected in new paired-runner executions, inspect this endpoint response first.

## Browser Concurrency Gates

Local browser dispatch is gated by all of the following:

- global queue cap: `RUNNER_MAX_CONCURRENT_RUNS`
- project-level cap: `LEAST(Project.maxConcurrentRuns, floor(RUNNER_MAX_CONCURRENT_RUNS / 2))`
- local worker cap: `RUNNER_MAX_LOCAL_BROWSER_RUNS`

If `RUNNER_MAX_LOCAL_BROWSER_RUNS` is unset, it falls back to `RUNNER_MAX_CONCURRENT_RUNS`.

Android runner claim is additionally gated by:

- per-runner Android cap: `RUNNER_MAX_CONCURRENT_RUNS_PER_ANDROID_RUNNER` (default `2`)
