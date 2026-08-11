# MCP Server Tooling Notes

This document defines SkyTest MCP tool behavior for maintainers.

## Source of Truth

- MCP tool registration: `apps/web/src/lib/mcp/server-registry.ts`
- MCP tool handlers: `apps/web/src/lib/mcp/server-tools.ts`
- MCP test case mutation tools: `apps/web/src/lib/mcp/test-case-mutation-tools.ts`
- MCP schemas: `apps/web/src/lib/mcp/server-schemas.ts`
- MCP auth helpers: `apps/web/src/lib/mcp/server-auth.ts`
- MCP response/telemetry: `apps/web/src/lib/mcp/server-response.ts`
- MCP server factory: `apps/web/src/lib/mcp/server.ts`
- HTTP transport endpoint: `apps/web/src/app/api/mcp/route.ts`

## Transport Authentication

- Authenticated requests must provide an API key (`sk_test_...`) in either:
  - `Authorization: Bearer <AGENT_API_KEY>`
  - `X-SkyTest-Api-Key: <AGENT_API_KEY>`

## Run Session Model

A run is one **member** of a **run session**, not a standalone unit:

- A test case can declare login-flow prefixes (browser targets with a `loginFlowId`). `run_test_case` creates a SINGLE run session whose members are each login-flow prefix (`kind = LOGIN_FLOW`) followed by the test itself (`kind = TEST`). The returned `runId` is the test member.
- A test group runs as a GROUP session: one member per configured login flow, then each group test case in order.
- A member that never runs (an earlier member failed, a login flow failed, the run was stopped) settles `CANCELLED` with a reason — there is no `SKIPPED` status.

So a single member reaching `PASS` does **not** mean the whole session finished. Read the rolled-up session status via `get_run_session` (or the `session` field on `get_test_run`) to know whether everything settled.

### Retry attempts

A test group can be configured to retry failed cases (`TestGroup.retryPolicy`: `NONE`, `FAILED_ONCE`, `FAILED_TWICE`, `WHOLE_GROUP_ONCE`). Retries run as extra passes **after** the whole group finishes, and each attempt is its own `TestRun` row, so:

- `get_run_session` returns **one member entry per case**, always its latest attempt, with superseded ones under `previousAttempts`. `get_test_run` reports a single run's own `attempt` (1 = original run).
- **Judge completion by the session `status`, never by the members.** Between retry rounds every member is terminal while the session is not, so "all members settled" does not mean the group finished.
- The session stays non-terminal between rounds (`retryPending = true`), so a `FAIL` or `CANCELLED` you read mid-retry is not final. Wait for a terminal `status`.
- Retries only start if something did not pass. A fully green group never retries, whatever its policy; `WHOLE_GROUP_ONCE` then re-runs every case, passing ones included.
- The retry budget is per case and counts only attempts that reached `PASS`/`FAIL`; a `CANCELLED` attempt never ran and spends nothing.
- **A case you stop is not retried.** `stop_all_runs`, `stop_all_queues` and the cancel that `update_test_case` performs all record a user-initiated cancellation reason, and retry planning treats those as resolved. A case the group itself skipped behind a failure (`EARLIER_CASE_FAILED`, `LOGIN_FLOW_FAILED`) still gets its retries.

### Stopping is always session-wide

Every stop path — the UI stop button, the single-run HTTP cancel, `stop_all_runs`, `stop_all_queues`, and `update_test_case` with `cancel_and_save` — stops the **whole run session** a run belongs to, never just that row.

A session cannot be partially stopped. Its driver decides what runs next, and cancelling one row neither aborts that driver nor releases the retry hold, so a group would carry on and a retry policy would re-create exactly what was cancelled. Standalone runs (no `runSessionId`) are still cancelled individually.

The consequence to expect: stopping one queued member of a group also stops that group's running member. The stop tools report those extra members in `sessionMembersAlsoCancelled` so the count is never silently larger than what you asked for.

### Test case kind

`TestCase.kind` is `TEST` or `LOGIN_FLOW`. A `LOGIN_FLOW` case is a reusable login flow; other cases reuse it by setting `loginFlowId` on a browser target. A grouped case's kind cannot be flipped while it is referenced by a test group (the test-case update route rejects it).

## Tool Contracts

### list_projects

- Lists all projects owned by the authenticated user.
- No input parameters.
- Returns: `id`, `name`, `testCaseCount`, `updatedAt` per project.

### get_project

- Input: `{ projectId }`
- Returns project details and project-level configs (sorted, masked values redacted).

### list_test_cases

- Input: `{ projectId, status?, limit? }`
- Returns test cases matching the filter (default limit 50, max 100).
- Fields returned: `id`, `displayId`, `status`, `kind`, `name`, `source`, `updatedAt`.

### get_test_case

- Input: `{ testCaseId }`
- Returns full test case: parsed steps, sorted configs (masked values redacted), and last 5 runs.

### create_test_case

- Input: `{ projectId, testCase }`
- Creates exactly one test case per call.
- Optional `testCase.kind` (`TEST` | `LOGIN_FLOW`, default `TEST`). Use `LOGIN_FLOW` to author a reusable login flow; other cases reference it by setting `loginFlowId` on a browser target in `browserConfig`/`browserTargets`.
- `update_test_case` does not change `kind` (kind is fixed at creation; this also prevents flipping a grouped case's kind out from under its group wiring).
- Accepted config types: `URL`, `VARIABLE`, `RANDOM_STRING`, `APP_ID`.
- `RANDOM_STRING` configs require one of: `TIMESTAMP_DATETIME`, `TIMESTAMP_UNIX`, `UUID`. Invalid values are skipped with a warning.
- `FILE` variables are rejected with a warning (MCP cannot upload file content).
- If a test-case variable matches an existing project-level config (same type and value), it is skipped with a warning naming the matching project variable.
- Android device names are resolved against runner-synced team inventory. If no match is found, the test case is still created but the response includes a warning so the caller can confirm with the user.
- Android targets may include optional `runnerId` for runner-scoped device targeting.
- Browser targets may include optional `loginFlowId`, `reuseGroupSession`, and `webauthnVirtualAuthenticator`. `webauthnVirtualAuthenticator` installs a virtual WebAuthn authenticator; passkey (WebAuthn) steps cannot complete in headless runs without it. `reuseGroupSession` only takes effect on a target that also has a `loginFlowId`.

### update_test_case

- Scope: one test case ID per call.
- Allowed mutable fields: `name`, `url`, `prompt`, `steps`, `browserConfig`, `configs`, `variables`, `removeConfigNames`, `removeVariableNames`.
- `RANDOM_STRING` config upserts require one of: `TIMESTAMP_DATETIME`, `TIMESTAMP_UNIX`, `UUID`. Invalid values are skipped with a warning.
- One or more mutable fields may be provided in each call.
- If active runs exist (`QUEUED`, `PREPARING`, `RUNNING`), caller must choose:
  - `cancel_and_save` — stops the run sessions those runs belong to, so a grouped case does not keep being run (or retried) against the edit being saved. Extra members stopped are reported in `sessionMembersAlsoCancelled`.
  - `do_not_save`

### delete_test_case

- Input: `{ testCaseId }`
- Deletes the test case and all related data (runs, files, configs) via Prisma cascade.
- Performs best-effort storage cleanup for uploaded test case files and `FILE` config objects. The response includes `deletedObjectCount` and `failedObjectKeys`.

### stop_all_runs

- Cancels all active test runs (`QUEUED`, `PREPARING`, `RUNNING`) for the authenticated user via durable DB state update.
- `projectId` is required and limits cancellation to one owned project.
- A run that belongs to a run session is stopped through the session, so its driver stops too and every member settles together. Stopped cases are not retried — see [Retry attempts](#retry-attempts) and [Stopping is always session-wide](#stopping-is-always-session-wide).
- Returns:
  - requested active run count
  - successful cancellation count
  - skipped cancellation count/details (runs that are no longer active at write time)
  - failure count/details
  - status summary before cancellation

### stop_all_queues

- Selects only queued test runs (`QUEUED`) for the authenticated user, then stops each one's run session as a unit — so a queued group member also stops its group, including any member currently running. See [Stopping is always session-wide](#stopping-is-always-session-wide).
- `projectId` is required and limits cancellation to one owned project.
- Returns:
  - requested queued run count
  - successful cancellation count
  - skipped cancellation count/details (runs that are no longer active at write time)
  - failure count/details
  - status summary before cancellation

### get_test_run

- Input: `{ runId }`
- Includes the run's own `attempt` (1 = original run, 2+ = a retry of that case within its session).
- Returns: `id`, `status`, `error`, `cancellationReasonCode`, `startedAt`, `completedAt`, `createdAt`, `kind`, `runSessionId`, `sessionPosition`, and `session` (`{ id, status, kind }` — the rolled-up run session, or `null` for a run with no session).
- `cancellationReasonCode` is a stable code (e.g. `USER_SINGLE`, `LOGIN_FLOW_FAILED`) for `CANCELLED` runs, else `null`.
- Prefer the `session.status` (or `get_run_session`) to decide whether the whole run finished; the member `status` only reflects this one member.

### get_project_test_summary

- Input: `{ projectId }`
- Returns: `total` test case count, `byStatus` breakdown, and `byKind` breakdown (`TEST` vs `LOGIN_FLOW`).

### run_test_case

- Input: `{ testCaseId, overrides? }`
- Queues one test run for the test case.
- Optional `overrides` fields: `url`, `prompt`, `steps`, `browserConfig`, `requestedDeviceId`, `requestedRunnerId`.
- Validation:
  - `requestedDeviceId` is allowed only when Android targets exist.
  - `requestedRunnerId` is allowed only when Android targets exist.
  - Android runs require a single resolved `requestedDeviceId`; if selectors are ambiguous, queueing is rejected.
  - `requestedDeviceId` must match one of the Android target device selectors in the final run configuration.
  - `requestedRunnerId` must match Android target runner scopes when runner scopes are present.
  - When Android targets contain multiple runner scope IDs and no `requestedRunnerId` override is provided, run queuing is rejected as ambiguous.
  - Auto-inference of `requestedDeviceId`/`requestedRunnerId` is applied only when the resolved target value is unique across Android targets.
- Creates a SINGLE run session and queues its members (login-flow prefixes + the test). The returned `runId` is the test member; use `get_run_session` on its `runSessionId` to watch the whole session.
- Uses durable queue path and returns: `runId`, `status`, `requiredCapability`, `requestedDeviceId`, `requestedRunnerId`.

### run_test_group

- Input: `{ projectId, testGroupId }`
- Queues a GROUP run session: each configured login flow runs first (establishing a reusable baseline), then the group's test cases run in order.
- Rejected with `409` if the group already has a run in progress, `404` if the group is missing/soft-deleted, `400` if it has no test cases.
- The group's configured retry policy applies and is snapshotted onto the session, so failed cases may be re-run before the session settles. See [Retry attempts](#retry-attempts).
- Returns: `{ sessionId }`. Watch it with `get_run_session`.

### get_run_session

- Input: `{ runSessionId }`
- Returns the session's rolled-up `status` and `kind`, `testGroupId`, timestamps, `retryPolicy`, `retryPending`, and a `members` array with one entry per case (`id`, `testCaseId`, `kind`, `sessionPosition`, `attempt`, `status`, `error`, `cancellationReasonCode`, `previousAttempts`).
- Use this (not `get_test_run` on a single member) to tell whether a whole group/login-flow run settled, and read the session `status` rather than inferring it from the members. See [Retry attempts](#retry-attempts).

### list_run_sessions

- Input: `{ projectId, testGroupId?, limit? }` (default limit 20, max 50)
- Returns a project's run sessions, most recent first, optionally scoped to one test group. Each entry: `id`, `kind`, `status`, `testGroupId`, `memberCount`, timestamps. `memberCount` counts cases, not attempts, so it does not grow when a group retries.

### list_test_runs

- Input: `{ projectId?, testCaseId?, runSessionId?, status?, from?, to?, limit?, cursor?, include? }`
- Returns paginated runs visible to the authenticated user (`deletedAt IS NULL`).
- Each run includes `kind`, `runSessionId`, `sessionPosition`, and `cancellationReasonCode` (stable code for `CANCELLED` runs, else `null`) alongside the existing fields. Login-flow prefix members appear as their own runs labeled by `kind`/`runSessionId`.
- `runSessionId` filters to all members of one run session.
- `include` supports:
  - `events`: per-run event list (up to 100 events per run).
  - `artifacts`: run file snapshots and event artifact keys with signed URLs when available.

### manage_project_configs

- Input: `{ projectId, upsert?, remove? }`
- Upserts project configs by normalized config name and removes configs in the same call.
- `FILE` upserts are skipped with warnings (upload unsupported in MCP).
- Removing existing `FILE` configs triggers best-effort object-store cleanup.
- Returns created/updated/removed counts, warnings, cleanup result, and sorted latest configs.

### list_runner_inventory

- Input: `{ projectId }`
- Returns team-scoped runner overview and device inventory for the project.
- Includes Android selector-ready options:
  - `connectedDevices` (serial selector)
  - `emulatorProfiles` (profile selector)
- Used by agents to ask users for concrete device/profile selection before create/run.

## Runtime Notes

- Always cancel through durable run state updates (`CANCELLED` + lease cleanup), never through in-memory queue paths.
- Durable cancellation uses an active-status write predicate to avoid overwriting terminal run states during races.
- Do not add batch update semantics to `update_test_case`; keep one-test-case-per-call behavior.
- `run_test_case` shares the same queue semantics as `/api/test-runs/dispatch` (capability selection, requested device checks, and file snapshot copy).
- Android device resolution uses runner inventory aliases (serial/name/profile metadata) from team-scoped runner inventory surfaced in `Team Settings -> Runners`. When no match is found, the raw input is used as emulator profile name and a warning is returned.
