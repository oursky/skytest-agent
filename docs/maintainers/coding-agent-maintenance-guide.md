# Coding Agent Maintenance Guide

This guide is for developers and coding agents making changes in this repository.

It complements `AGENTS.md` with repository-specific runtime invariants.

## Read These First

- `AGENTS.md` (repo workflow, constraints, style)
- [android-runtime-maintenance.md](./android-runtime-maintenance.md)
- [slack-notification-architecture.md](./slack-notification-architecture.md)
- [../../infra/README.md](../../infra/README.md)

## High-Risk Runtime Areas

### 1. Runner Orchestration (`apps/web/src/lib/runners/*`, `apps/web/src/app/api/runners/v1/*`)

Responsibilities:

- runner auth and token lifecycle
- claim/lease ownership for queued runs
- runner heartbeat/device sync
- ordered event ingestion and terminal run transitions
- retention and lease maintenance (`apps/web/src/workers/runner-maintenance.ts`)

Key invariants:

- claim must be atomic and prevent double-claim
- write-back endpoints must enforce assigned runner + active lease ownership
- stream token scope checks must remain strict per run/resource
- maintenance tasks should stay out of Next.js request lifecycle

### 2. Runner Client (`apps/macos-runner/runner/index.ts`)

Responsibilities:

- register/heartbeat with control plane
- publish device inventory
- claim Android jobs and execute tests
- push events/artifacts/final status

Key invariants:

- protocol version fields must be sent on every runner request
- runner token rotation/expiry behavior must not be bypassed
- runners must not mutate app installation state automatically

### 3. Execution Engine (`apps/web/src/lib/runtime/test-runner.ts`)

Responsibilities:

- shared browser/Android execution logic used by runner clients
- step execution, event generation, and cleanup behavior

Decomposed into focused modules:

- `android-runtime-helpers.ts` - Android ADB recovery, wake/unlock, permissions, app lifecycle
- `assertion-verifier.ts` - Quoted string AI verification
- `assertion-shortcuts.ts` - Assertion pattern detection and formatting
- `execution-files.ts` - Temp file materialization for run-time file configs
- `playwright-code-execution.ts` - Playwright code step sandbox execution
- `network-guard-summary.ts` - Browser network guard log emission
- `local-browser-runner-parsers.ts` - Config snapshot/image data URL parsers

Key invariants:

- cleanup must stay idempotent when cancellation races run completion
- Android device handles must be released via `androidDeviceManager.release(...)`
- `clearAppState` and permission behavior must remain stable

## Runtime Relationship

- `apps/cli`: operator control plane from terminal (`pair/start/stop/logs/reset`).
- `apps/macos-runner`: long-running Android execution worker process.
- `apps/web`: web UI + API control plane + MCP server.

The CLI supervises local runner lifecycle; the macOS runner executes jobs.

## Backend / Frontend / MCP Boundaries

| Boundary | Location | Responsibilities |
|---|---|---|
| Frontend | `apps/web/src/app/**`, `apps/web/src/components/**` | App Router pages, UI rendering, client hooks |
| Web backend | `apps/web/src/app/api/**`, `apps/web/src/lib/**`, `apps/web/src/workers/**` | API auth, queueing, scheduling, persistence, maintenance loops |
| MCP backend | `apps/web/src/app/api/mcp/route.ts`, `apps/web/src/lib/mcp/**` | MCP transport, tool contracts, tool execution |
| Operator backend | `apps/cli/**` | Human-operated runtime control commands |
| Runner backend | `apps/macos-runner/**` | Runner register/heartbeat/claim/execute/event/artifact flows |

## Control Plane Constraints

- Browser execution is dispatched per run from API or MCP queueing paths and runs inside control-plane processes.
- Do not re-introduce a dedicated `runner:browser` workload or parallel raw deployment-manifest systems for the same topology.
- Android execution stays runner-owned and must not move into web request handlers.
- Team-facing device visibility must come from runner-published inventory, not host-local inspection.
- Do not re-introduce project-scoped device inventory surfaces; active UI is `Team Settings -> Runners`.
- Do not re-introduce host-local Android inventory assumptions into web APIs.

If you add features that expose Android state/control:

- preserve ownership checks
- keep behavior team/project-scoped through runner ownership
- avoid privileged host-level actions from web routes

## Local Orchestration

The top-level `Makefile` is the source of truth for multi-step local workflows:

- `make bootstrap` installs dependencies, starts local services, and applies the schema
- `make dev` starts the local control plane plus the maintenance and browser workers (the maintenance worker also runs the scheduler tick)
- `make app` starts only the Next.js control plane
- `make maintenance` starts only the maintenance loop (which also runs the scheduler tick)
- `make runner-reset` clears local runner state
- `make verify` runs the repo verification checks
- `npm run --workspace @skytest/web load-gate:sse:smoke` runs the SSE smoke load gate (`/api/test-runs/[id]/events`)
- `npm run --workspace @skytest/web perf:gate:runner-events` runs runner event-ingestion endpoint load checks (k6)

Do not duplicate those workflows in new scripts or stale runbooks.

## Verification Gates

`npm run verify` (workspace `@skytest/web`) is the baseline pre-commit gate and now enforces:

- lint + TypeScript compile
- auth-route deny-by-default coverage (`auth:check-routes`)
- runner-protocol import boundary check (`protocol:check-boundary`)
- hotspot LOC threshold + ADR exceptions (`quality:check-hotspots`)
- config/i18n modularization + locale consistency guardrails (`quality:check-config-i18n`)
- runner contract centralization check (`quality:check-runner-contracts`)
- dependency audit allowlist policy (`audit`)

Runner defaults are centralized in `@skytest/runner-protocol`:

- `RUNNER_DEFAULT_CAPABILITIES`
- `RUNNER_DEFAULT_TRANSPORT`

Do not re-introduce hardcoded runner capabilities or transport fallbacks in CLI, macOS runner, or web runner protocol modules.

## AI Key Validation Is Centralized

When changing team AI key handling, keep validation logic centralized in:

- `apps/web/src/lib/validation/ai-api-key.ts`

Boundary consistency is enforced by:

- `apps/web/src/lib/validation/__tests__/ai-api-key-boundaries.test.ts`

Do not duplicate or fork key-format rules in UI routes, API handlers, or runtime modules.

## Browser Network Guard And Failure Metadata

When changing browser execution behavior, keep these invariants stable:

- DNS lookup is fail-closed before navigation and during guarded requests.
- Private, loopback, and internal destinations remain blocked after DNS resolution.
- `classifyRunFailure` writes `errorCode` and `errorCategory` into `TestRun.result`.
- `GET /api/test-runs/:id`, the SSE event stream, and the result viewer all depend on that stored failure metadata.

## Documentation Update Checklist for Code Changes

When changing runner runtime behavior, update docs in the same PR/commit series:

- Infrastructure impact:
  - [../../infra/README.md](../../infra/README.md)
- Maintainer-facing impact:
  - [android-runtime-maintenance.md](./android-runtime-maintenance.md)
- Import/export behavior:
  - [test-case-excel-format.md](./test-case-excel-format.md)

## Common Footguns

- Settling `RunSession.status` while members are still queued or executing. The rollup
  (`apps/web/src/lib/runtime/run-session-status.ts`) must stay `RUNNING` until every member
  settles: a terminal session status means "execution is over" to the inactive-run sweep
  (`abortInactiveLocalBrowserRuns`), the group Stop button, the "already has a run in
  progress" trigger guard, and Slack group notify. A rollup that settles on the first failure
  makes the sweep abort a live CONTINUE-mode group mid-run.
- Counting a retried group's `memberRuns` directly. A test group with a retry policy creates one
  `TestRun` row **per attempt** (`TestRun.attempt`), so any status rollup or members list must
  first reduce to the latest attempt per `testCaseId` via `resolveLatestAttempts`, and any
  member/pass/total count must go through `countSessionCases`
  (`apps/web/src/lib/runtime/test-group-retry-plan.ts`). Counting rows double-counts retried cases
  and reports already-recovered failures as current.
- Ending a group session's execution without releasing `RunSession.retryPending`. That flag holds
  the session at `RUNNING` once every member is terminal but more rounds may follow; every exit
  path — the orchestrator's `finally`, the stop button (`cancel-run.ts`), and the stranded-session
  reaper — must call `releaseSessionRetryHold`, or a fully-terminal session stays `RUNNING` forever
  and permanently blocks the group from being edited or re-run.
- Confusing a retry policy's **trigger** with its **scope**. Every policy needs an unresolved case
  before it retries anything — a group that came back fully green is finished, whatever the policy.
  `WHOLE_GROUP_ONCE` differs only in scope: once something is unresolved it re-runs every case,
  passing ones included, because a sequential group's later cases may depend on state its earlier
  ones build. Triggering it unconditionally burns a second full pass, and doubles AI-action spend,
  on groups that had nothing wrong.
- Finding work to stop by querying runs alone. The retry hold makes a session live with **every
  member terminal**, so a project-wide search for active runs turns up nothing in the gap between
  retry rounds while the group is about to start another one. Anything that stops, sweeps, or reaps
  must also consider non-terminal `RunSession` rows — see `findLiveSessionIdsForStop`.
- Holding the rollup for an outcome that cannot be retried. `retryPending` suppresses `FAIL` and
  `CANCELLED` because either can still be retried, but `PASS` must settle immediately — otherwise a
  green group stays `RUNNING` until the orchestrator's `finally`, and a crash right after round 0
  delays a correct `PASS` until the stranded-session reaper's stale window elapses.
- Adding a retry-eligibility rule without a termination argument. The retry budget is per case and
  counts only attempts that reached `PASS`/`FAIL`, so a case cancelled by stop-on-failure sits at
  `executed = 0` indefinitely. `planRetryRound` therefore stops entirely once an unresolved case
  under STOP has exhausted its budget; without that rule the cases behind a permanently broken one
  are replanned forever.
- Changing Excel import parser compatibility paths without updating [test-case-excel-format.md](./test-case-excel-format.md)
- Breaking runner protocol request/response shapes without updating `packages/runner-protocol`
- Bypassing lease ownership checks on runner write-back endpoints
- Re-introducing dedicated browser worker deployments
- Re-introducing browser-side `process.env` dependencies for deployment-specific config
- Changing operator-visible runner/device behavior without updating setup/runbook docs

## Browser Failure Triage (Blank Page / Selector Not Found)

Use this sequence before changing test steps:

1. Inspect run events for runtime guard blocks:
   - `Blocked request to <host>: <reason>`
   - `Network guard summary: {...}`
2. From the same runtime host, verify DNS and HTTP:
   - `node -e "require('node:dns').promises.lookup('<host>', { all: true, verbatim: true }).then(console.log).catch(console.error)"`
   - `curl -I https://<host>/<path>`
3. If requests are blocked by the runtime guard, fix network or policy first; do not tweak selectors yet.
4. Only debug Playwright selectors/assertions after network guard errors are resolved.
