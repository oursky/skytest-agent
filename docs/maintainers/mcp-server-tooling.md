# MCP Server Tooling Notes

This document defines current SkyTest MCP tool behavior for maintainers.

## Source of Truth

- MCP server implementation: `src/lib/mcp-server.ts`
- HTTP transport endpoint: `src/app/api/mcp/route.ts`

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
- Android device names are resolved against the device inventory. If no match is found, the test case is still created but the response includes a warning so the caller can confirm with the user.

### update_test_case

- Scope: one test case ID per call.
- Allowed mutable fields: `name`, `url`, `prompt`, `steps`, `browserConfig`.
- One or more mutable fields may be provided in each call.
- If active runs exist (`QUEUED`, `PREPARING`, `RUNNING`), caller must choose:
  - `cancel_and_save`
  - `do_not_save`

### delete_test_case

- Input: `{ testCaseId }`
- Deletes the test case and all related data (runs, files, configs) via Prisma cascade.

### stop_all_runs

- Cancels all active test runs (`QUEUED`, `PREPARING`, `RUNNING`) for the authenticated user via queue cancellation.
- `projectId` is required and limits cancellation to one owned project.
- Returns:
  - requested active run count
  - successful cancellation count
  - failure count/details
  - status summary before cancellation

### stop_all_queues

- Cancels only queued test runs (`QUEUED`) for the authenticated user via queue cancellation.
- `projectId` is required and limits cancellation to one owned project.
- Returns:
  - requested queued run count
  - successful cancellation count
  - failure count/details
  - status summary before cancellation

### get_test_run

- Input: `{ runId }`
- Returns: `id`, `status`, `error`, `startedAt`, `completedAt`, `createdAt`.

### get_project_test_summary

- Input: `{ projectId }`
- Returns: `total` test case count and `byStatus` breakdown.

## Runtime Notes

- Always cancel through `queue.cancel(...)` to keep queue/running/cleanup paths consistent.
- Do not add batch update semantics to `update_test_case`; keep one-test-case-per-call behavior.
- Android device resolution uses multiple fallback strategies (exact name, case-insensitive, normalized, prefix match). When no match is found, the raw input is used as emulator profile name and a warning is returned.
