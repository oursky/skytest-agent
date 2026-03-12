# MCP Server Tooling Notes

This document defines current SkyTest MCP tool behavior for maintainers.

## Source of Truth

- MCP server implementation: `apps/web/src/lib/mcp/server.ts`
- HTTP transport endpoint: `apps/web/src/app/api/mcp/route.ts`

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
- Fields returned: `id`, `displayId`, `status`, `name`, `source`, `updatedAt`.

### get_test_case

- Input: `{ testCaseId }`
- Returns full test case: parsed steps, sorted configs (masked values redacted), and last 5 runs.

### create_test_case

- Input: `{ projectId, testCase }`
- Creates exactly one test case per call.
- Accepted config types: `URL`, `VARIABLE`, `RANDOM_STRING`, `APP_ID`.
- `FILE` variables are rejected with a warning (MCP cannot upload file content).
- If a test-case variable matches an existing project-level config (same type and value), it is skipped with a warning naming the matching project variable.
- Android device names are resolved against runner-synced team inventory. If no match is found, the test case is still created but the response includes a warning so the caller can confirm with the user.
- Android targets may include optional `runnerId` for runner-scoped device targeting.

### update_test_case

- Scope: one test case ID per call.
- Allowed mutable fields: `name`, `url`, `prompt`, `steps`, `browserConfig`, `configs`, `variables`, `removeConfigNames`, `removeVariableNames`.
- One or more mutable fields may be provided in each call.
- If active runs exist (`QUEUED`, `PREPARING`, `RUNNING`), caller must choose:
  - `cancel_and_save`
  - `do_not_save`

### delete_test_case

- Input: `{ testCaseId }`
- Deletes the test case and all related data (runs, files, configs) via Prisma cascade.
- Performs best-effort storage cleanup for uploaded test case files and `FILE` config objects. The response includes `deletedObjectCount` and `failedObjectKeys`.

### stop_all_runs

- Cancels all active test runs (`QUEUED`, `PREPARING`, `RUNNING`) for the authenticated user via durable DB state update.
- `projectId` is required and limits cancellation to one owned project.
- Returns:
  - requested active run count
  - successful cancellation count
  - skipped cancellation count/details (runs that are no longer active at write time)
  - failure count/details
  - status summary before cancellation

### stop_all_queues

- Cancels only queued test runs (`QUEUED`) for the authenticated user via durable DB state update.
- `projectId` is required and limits cancellation to one owned project.
- Returns:
  - requested queued run count
  - successful cancellation count
  - skipped cancellation count/details (runs that are no longer active at write time)
  - failure count/details
  - status summary before cancellation

### get_test_run

- Input: `{ runId }`
- Returns: `id`, `status`, `error`, `startedAt`, `completedAt`, `createdAt`.

### get_project_test_summary

- Input: `{ projectId }`
- Returns: `total` test case count and `byStatus` breakdown.

### run_test_case

- Input: `{ testCaseId, overrides? }`
- Queues one test run for the test case.
- Optional `overrides` fields: `url`, `prompt`, `steps`, `browserConfig`, `requestedDeviceId`, `requestedRunnerId`.
- Validation:
  - `requestedDeviceId` is allowed only when Android targets exist.
  - `requestedRunnerId` is allowed only when Android targets exist.
  - `requestedDeviceId` must match one of the Android target device selectors in the final run configuration.
- Uses durable queue path and returns: `runId`, `status`, `requiredCapability`, `requestedDeviceId`, `requestedRunnerId`.

### list_test_runs

- Input: `{ projectId?, testCaseId?, status?, from?, to?, limit?, cursor?, include? }`
- Returns paginated runs visible to the authenticated user (`deletedAt IS NULL`).
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
